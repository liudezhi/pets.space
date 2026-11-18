import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync,
  mkdirSync, openSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MODES = new Set(['stripe-test', 'stripe-live']);
const { O_CREAT, O_DIRECTORY, O_EXCL, O_NOFOLLOW, O_RDONLY, O_RDWR, O_WRONLY } = constants;

export function initializeInvites(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS issued_invites (
    mode TEXT NOT NULL CHECK(mode IN ('stripe-test','stripe-live')),
    digest TEXT NOT NULL CHECK(length(digest)=64),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(mode,digest)
  ) WITHOUT ROWID`);
}

export function hasInvite(db, mode, digest) {
  if (!MODES.has(mode) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) return false;
  return Boolean(db.prepare('SELECT 1 FROM issued_invites WHERE mode=? AND digest=?').get(mode, digest));
}

function privateDirectory(path, create) {
  let current = parse(path).root;
  const root = current;
  for (const component of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, component);
    if (create) {
      try { mkdirSync(current, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (!lstatSync(current).isDirectory()) throw new Error('目录路径中包含符号链接或普通文件。');
  }
  const directory = lstatSync(path);
  if (directory.uid !== process.getuid() || (directory.mode & 0o077) !== 0) {
    throw new Error('请使用当前用户持有且权限为 0700 的专用目录。');
  }
}

function openInviteDatabase(path) {
  // DatabaseSync opens by path. A private parent and a checked private regular
  // file protect the SQLite open and its journal files from other local users.
  const fd = openSync(path, O_RDWR | O_CREAT | O_NOFOLLOW, 0o600);
  try {
    const file = fstatSync(fd);
    if (!file.isFile() || file.uid !== process.getuid() || file.nlink !== 1) {
      throw new Error('数据库必须是当前用户持有的普通独立文件。');
    }
    fchmodSync(fd, 0o600);
  } finally {
    closeSync(fd);
  }
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecar = lstatSync(path + suffix, { throwIfNoEntry: false });
    if (sidecar && (!sidecar.isFile() || sidecar.uid !== process.getuid() || sidecar.nlink !== 1)) {
      throw new Error('数据库日志文件的类型或所有者不符。');
    }
  }
  return new DatabaseSync(path);
}

function unlinkOwnFile(path, expected) {
  const found = lstatSync(path, { throwIfNoEntry: false });
  if (found && expected && found.dev === expected.dev && found.ino === expected.ino) unlinkSync(path);
}

// The CLI checks deployment-specific public roots. The store also requires a
// private delivery directory and publishes the full list atomically without replacement.
export function issueInvites({ dataDir, mode, count, outputFile }) {
  if (!MODES.has(mode)) throw new Error('邀请码签发环境必须为 stripe-test 或 stripe-live。');
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new Error('每批可签发 1 至 1000 个邀请码。');
  if (typeof outputFile !== 'string' || !outputFile.trim() || typeof dataDir !== 'string' || !dataDir.trim()) {
    throw new Error('需要配置专用数据目录和新交付文件路径。');
  }
  const dest = resolve(outputFile), directory = dirname(dest), data = resolve(dataDir);
  const databasePath = join(data, 'memorials.sqlite');
  if ([databasePath, databasePath + '-wal', databasePath + '-shm', databasePath + '-journal', join(data, 'sandbox-invite.txt')].includes(dest)) {
    throw new Error('交付文件不能占用运行时数据文件的名称。');
  }
  privateDirectory(directory, false);
  if (lstatSync(dest, { throwIfNoEntry: false })) throw new Error('交付文件已存在，请指定新文件。');
  privateDirectory(data, true);

  const db = openInviteDatabase(databasePath);
  const temp = join(directory, '.invite-delivery-' + randomUUID());
  let directoryFd, fd, identity;
  let transactionOpen = false, published = false, committing = false, committed = false;
  try {
    // Respect the database's existing journal mode, including a running WAL-backed server.
    db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
    transactionOpen = true;
    initializeInvites(db);
    const insert = db.prepare('INSERT INTO issued_invites(mode,digest,created_at) VALUES(?,?,?)');
    const now = Date.now();
    directoryFd = openSync(directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    fd = openSync(temp, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600);
    identity = fstatSync(fd);
    fchmodSync(fd, 0o600);
    for (let i = 0; i < count; i++) {
      const value = randomBytes(32).toString('base64url');
      const digest = createHash('sha256').update(value).digest('hex');
      insert.run(mode, digest, now);
      writeFileSync(fd, value + '\n', 'utf8');
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    linkSync(temp, dest);
    published = true;
    unlinkSync(temp);
    fsyncSync(directoryFd);
    // A crash before COMMIT can leave an inert delivery file. A committed
    // batch already has a durable, complete delivery file in its final location.
    committing = true;
    db.exec('COMMIT');
    committed = true;
    transactionOpen = false;
    return { count, mode, outputFile: dest };
  } catch (error) {
    let rolledBack = false;
    if (transactionOpen) {
      try { db.exec('ROLLBACK'); rolledBack = true; }
      catch { /* A storage fault may leave the outcome of COMMIT uncertain. */ }
    }
    if (published && !committed && (!committing || rolledBack)) {
      unlinkOwnFile(dest, identity);
      fsyncSync(directoryFd);
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (identity) unlinkOwnFile(temp, identity);
    if (directoryFd !== undefined) closeSync(directoryFd);
    db.close();
  }
}

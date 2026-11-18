import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const databaseName = 'memorials.sqlite';
const manifestName = 'manifest.json';
const format = 'pets.space/store';
const repository = fileURLToPath(new URL('..', import.meta.url));
const coreTables = ['owners', 'sessions', 'gardens', 'flowers'];

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

async function requireFile(path) {
  if (!(await lstat(path)).isFile()) throw new Error('输入应为普通文件。');
}

function inspect(db) {
  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('SQLite 完整性校验失败。');
  if (db.prepare('PRAGMA foreign_key_check').get()) throw new Error('SQLite 外键校验失败。');
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => row.name);
  if (coreTables.some(table => !tables.includes(table))) throw new Error('缺少纪念档案的核心数据表。');
  return db.prepare('PRAGMA user_version').get().user_version;
}

function inspectFile(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return inspect(db); } finally { db.close(); }
}

async function checksum(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function flush(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

// Stage on the same filesystem. rename cannot replace a nonempty directory on POSIX.
async function publish(source, destination, populate) {
  const sourceDir = await realpath(source);
  const target = resolve(destination);
  const parent = await realpath(dirname(target));
  const final = join(parent, basename(target));
  if (isInside(repository, final) || isInside(sourceDir, final) || isInside(final, sourceDir)) {
    throw new Error('请为输出选择项目目录之外、与输入分离的目录。');
  }
  const existing = await lstat(final).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing && (!existing.isDirectory() || (await readdir(final)).length)) {
    throw new Error('目标已被占用，请选择新的目录或空目录。');
  }
  const stage = await mkdtemp(join(parent, '.pets-archive-'));
  try {
    await populate(sourceDir, stage);
    for (const name of await readdir(stage)) await flush(join(stage, name));
    await flush(stage);
    await rename(stage, final);
    await flush(parent);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function backupStore(dataDir, archiveDir) {
  await publish(dataDir, archiveDir, async (sourceDir, stage) => {
    const source = join(sourceDir, databaseName);
    const copy = join(stage, databaseName);
    await requireFile(source);
    const db = new DatabaseSync(source, { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout=5000');
      db.prepare('VACUUM INTO ?').run(copy);
    } finally {
      db.close();
    }
    await chmod(copy, 0o600);
    const schemaVersion = inspectFile(copy);
    const info = await lstat(copy);
    const manifest = { format, version: 1, createdAt: new Date().toISOString(), file: databaseName,
      schemaVersion, bytes: info.size, sha256: await checksum(copy) };
    await writeFile(join(stage, manifestName), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  });
}

export async function restoreStore(archiveDir, restoredDataDir) {
  await publish(archiveDir, restoredDataDir, async (sourceDir, stage) => {
    const metadata = join(sourceDir, manifestName);
    await requireFile(metadata);
    if ((await lstat(metadata)).size > 8192) throw new Error('备份清单过大。');
    let manifest;
    try { manifest = JSON.parse(await readFile(metadata, 'utf8')); }
    catch { throw new Error('备份清单无法解析。'); }
    if (manifest?.format !== format || manifest.version !== 1 || manifest.file !== databaseName
      || !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0 || !Number.isInteger(manifest.schemaVersion)
      || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('备份清单格式或版本不受支持。');
    const source = join(sourceDir, databaseName);
    const copy = join(stage, databaseName);
    await requireFile(source);
    if ((await lstat(source)).size !== manifest.bytes) throw new Error('备份文件长度不匹配。');
    await copyFile(source, copy);
    await chmod(copy, 0o600);
    if ((await checksum(copy)) !== manifest.sha256) throw new Error('备份文件 SHA-256 校验失败。');
    if (inspectFile(copy) !== manifest.schemaVersion) throw new Error('数据库版本与清单不符。');
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, source, target, ...extra] = process.argv.slice(2);
  if (!['backup', 'restore'].includes(command) || !source || !target || extra.length) {
    console.error('用法：node server/archive-store.mjs backup|restore 输入目录 输出目录');
    process.exitCode = 2;
  } else {
    try {
      await (command === 'backup' ? backupStore : restoreStore)(source, target);
      console.info(command === 'backup' ? '备份已生成并校验。' : '备份已校验并恢复至目标目录。');
    } catch (error) {
      console.error('操作失败。' + error.message);
      process.exitCode = 1;
    }
  }
}

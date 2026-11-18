import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { backupStore, restoreStore } from '../server/archive-store.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pets-backup-test-'));
  const source = join(root, 'live');
  await mkdir(source);
  const data = join(source, 'memorials.sqlite');
  const archive = join(root, 'snapshot');
  const target = join(root, 'recovered');
  const writer = new DatabaseSync(data);
  writer.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA wal_autocheckpoint=0;
    CREATE TABLE owners(id TEXT PRIMARY KEY);
    CREATE TABLE sessions(owner TEXT REFERENCES owners(id));
    CREATE TABLE gardens(id TEXT PRIMARY KEY,owner TEXT REFERENCES owners(id),photo BLOB,is_public INTEGER);
    CREATE TABLE flowers(garden TEXT REFERENCES gardens(id));
    INSERT INTO owners VALUES('sample');
    INSERT INTO gardens VALUES('river','sample',X'01020304',0);
    INSERT INTO flowers VALUES('river');
  `);
  t.after(async () => { writer.close(); await rm(root, { recursive: true, force: true }); });
  return { root, source, archive, target, data, writer };
}

test('live backup includes committed WAL changes, omits uncommitted rows and preserves private media', async t => {
  const { source, archive, target, data, writer } = await fixture(t);
  await writeFile(join(source, 'server.log'), 'test marker');
  writer.exec("BEGIN IMMEDIATE; INSERT INTO flowers VALUES('river')");
  assert.ok((await stat(data + '-wal')).size > 0);
  await backupStore(source, archive);
  writer.exec('COMMIT');
  assert.deepEqual((await readdir(archive)).sort(), ['manifest.json', 'memorials.sqlite']);
  const copy = join(archive, 'memorials.sqlite');
  const manifest = JSON.parse(await readFile(join(archive, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sha256, digest(await readFile(copy)));
  assert.equal((await stat(copy)).mode & 0o777, 0o600);
  await mkdir(target);
  await restoreStore(archive, target);
  const db = new DatabaseSync(join(target, 'memorials.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT count(*) AS n FROM flowers').get().n, 1);
    const garden = db.prepare('SELECT * FROM gardens').get();
    assert.equal(garden.is_public, 0);
    assert.equal(Buffer.from(garden.photo).toString('hex'), '01020304');
  } finally { db.close(); }
});

test('a retry or competing restore never overwrites published or user-owned data', async t => {
  const { source, archive, target } = await fixture(t);
  await backupStore(source, archive);
  await assert.rejects(backupStore(source, archive), /占用/);
  const results = await Promise.allSettled([restoreStore(archive, target), restoreStore(archive, target)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const data = join(target, 'memorials.sqlite');
  const first = await readFile(data);
  await assert.rejects(restoreStore(archive, target), /占用/);
  assert.deepEqual(await readFile(data), first);
});

test('corrupt, foreign-key-invalid or unknown-version snapshots cannot replace an empty restore target', async t => {
  const { root, source, archive, target, writer } = await fixture(t);
  await backupStore(source, archive);
  await mkdir(target);
  const meta = join(archive, 'manifest.json');
  const manifest = JSON.parse(await readFile(meta, 'utf8'));
  await writeFile(meta, JSON.stringify({ ...manifest, version: 999 }));
  await assert.rejects(restoreStore(archive, target), /版本/);
  const data = join(archive, 'memorials.sqlite');
  const broken = await readFile(data);
  broken[2] ^= 0xff;
  await writeFile(data, broken);
  await writeFile(meta, JSON.stringify(manifest));
  await assert.rejects(restoreStore(archive, target), /SHA-256/);
  await writeFile(meta, JSON.stringify({ ...manifest, sha256: digest(broken) }));
  await assert.rejects(restoreStore(archive, target));
  assert.deepEqual(await readdir(target), []);
  writer.exec("PRAGMA foreign_keys=OFF; INSERT INTO flowers VALUES('missing')");
  await assert.rejects(backupStore(source, join(root, 'bad')), /外键/);
  assert.ok(!(await readdir(root)).some(name => name.startsWith('.pets-archive-') || name === 'bad'));
});

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';


const inviteCode = 'garden-test-invite';
const photo = await readFile(new URL('../public/pet.webp', import.meta.url));
const photoDataUrl = 'data:image/webp;base64,' + photo.toString('base64');

async function garden(t, { includeSample = false, prepare } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'pets-space-memorial-'));
  let child;
  let origin;
  async function start() {
    const program = `
      import { createServer } from 'node:http';
      import { readFileSync } from 'node:fs';
      import { createMemorialApi } from ${JSON.stringify(new URL('../server/memorial-api.mjs', import.meta.url).href)};
      const options = { dataDir: process.argv[1], inviteCode: process.argv[2] };
      if (process.argv[3] === 'with-sample') options.samplePhoto = readFileSync(new URL(${JSON.stringify(new URL('../public/pet.webp', import.meta.url).href)}));
      const handler = await createMemorialApi(options);
      const server = createServer((req, res) => {
        Promise.resolve(handler(req, res, () => res.writeHead(404).end())).catch((error) => {
          res.writeHead(500).end(error.message);
        });
      });
      server.listen(0, '127.0.0.1', () => process.send(server.address().port));
    `;
    child = spawn(process.execPath, ['--input-type=module', '--eval', program, dataDir, inviteCode, includeSample ? 'with-sample' : 'without-sample'], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const port = await new Promise((resolve, reject) => {
      const exited = (code) => reject(new Error('Test server exited before listening (code ' + code + ')'));
      child.once('exit', exited);
      child.once('error', reject);
      child.once('message', (port) => {
        child.off('exit', exited);
        resolve(port);
      });
    });
    origin = 'http://127.0.0.1:' + port;
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  t.after(async () => {
    await stop();
    await rm(dataDir, { recursive: true, force: true });
  });
  if (prepare) prepare(dataDir);
  await start();

  // Each caller represents a separate browser. Reopening the service preserves the cookies.
  function browser() {
    const cookies = new Map();
    return async (route, { method = 'GET', body, headers = {} } = {}) => {
      const response = await fetch(origin + route, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json', origin }),
          ...(cookies.size ? { cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; ') } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';', 1)[0], separator = pair.indexOf('=');
        cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
      return response;
    };
  }
  return {
    browser,
    async restart() {
      await stop();
      await start();
    },
  };
}

async function success(response) {
  assert.ok(response.ok, 'Expected success, received HTTP ' + response.status + ' at ' + response.url);
  return response.json();
}

const post = (body) => ({ method: 'POST', body });
const patch = (body) => ({ method: 'PATCH', body });

async function joinGarden(client) {
  const session = await success(await client('/api/session', post({ code: inviteCode })));
  assert.equal(session.owner, true);
  assert.equal(typeof session.recoveryKey, 'string');
  assert.ok(session.recoveryKey.length);
  return session.recoveryKey;
}

async function createGarden(client, name, place = 'stone') {
  const { garden } = await success(await client('/api/gardens', post({
    name, place, story: '喜欢在河边晒太阳。', photo: photoDataUrl,
  })));
  assert.ok(garden.id);
  assert.equal(garden.name, name);
  assert.equal(garden.place, place);
  assert.equal(garden.isPublic, false);
  assert.equal(garden.acceptsFlowers, true);
  return garden;
}

async function listedIds(client, route) {
  const { gardens } = await success(await client(route));
  return gardens.map(({ id }) => id).sort();
}

test('同源 JSON 开通会话，一次性恢复钥匙可以换设备', async (t) => {
  const site = await garden(t);
  const owner = site.browser(), replacement = site.browser(), stranger = site.browser();
  assert.equal((await success(await owner('/api/session'))).owner, false);
  assert.equal((await owner('/api/mine')).status, 401);
  assert.equal((await owner('/api/session', post({ code: 'wrong-code' }))).status, 401);
  const badOrigin = await owner('/api/session', {
    ...post({ code: inviteCode }), headers: { origin: 'https://unrelated.example' },
  });
  assert.equal(badOrigin.status, 403);
  const wrongType = await owner('/api/session', {
    ...post({ code: inviteCode }), headers: { 'content-type': 'text/plain' },
  });
  assert.equal(wrongType.status, 415);
  assert.equal((await success(await owner('/api/session'))).owner, false);

  const firstKey = await joinGarden(owner);
  assert.deepEqual(await success(await owner('/api/session', post({ code: inviteCode }))), { owner: true });
  const pet = await createGarden(owner, '桂花');
  const restored = await success(await replacement('/api/restore', post({ key: firstKey })));
  assert.equal(restored.owner, true);
  assert.ok(restored.recoveryKey);
  assert.notEqual(restored.recoveryKey, firstKey);
  assert.deepEqual(await listedIds(replacement, '/api/mine'), [pet.id]);
  assert.equal((await stranger('/api/restore', post({ key: firstKey }))).status, 401);
  assert.equal((await stranger('/api/mine')).status, 401);
  const next = await success(await stranger('/api/restore', post({ key: restored.recoveryKey })));
  assert.equal(next.owner, true);
  assert.notEqual(next.recoveryKey, restored.recoveryKey);
  assert.deepEqual(await listedIds(stranger, '/api/mine'), [pet.id]);
});

test('两位主人拥有独立私密花园，公开和撤回同时作用于详情、照片与列表', async (t) => {
  const site = await garden(t);
  const alice = site.browser(), bob = site.browser(), visitor = site.browser();
  await joinGarden(alice);
  await joinGarden(bob);
  const a = await createGarden(alice, '云朵');
  const b = await createGarden(bob, '松子', 'entrance');
  const path = '/api/gardens/' + a.id;
  assert.deepEqual(await listedIds(alice, '/api/mine'), [a.id]);
  assert.deepEqual(await listedIds(bob, '/api/mine'), [b.id]);
  assert.deepEqual(await listedIds(visitor, '/api/public'), []);
  assert.equal((await success(await alice(path))).garden.name, a.name);
  const privatePhoto = await alice(path + '/photo');
  assert.equal(privatePhoto.status, 200);
  assert.match(privatePhoto.headers.get('content-type'), /^image\/webp\b/);
  assert.deepEqual(Buffer.from(await privatePhoto.arrayBuffer()), photo);
  for (const other of [bob, visitor]) {
    assert.equal((await other(path)).status, 404);
    assert.equal((await other(path + '/photo')).status, 404);
  }
  assert.equal((await bob(path, patch({ isPublic: true }))).status, 404);
  assert.equal((await success(await alice(path))).garden.isPublic, false);

  await success(await alice(path, patch({ isPublic: true })));
  assert.deepEqual(await listedIds(visitor, '/api/public'), [a.id]);
  assert.equal((await success(await visitor(path))).garden.id, a.id);
  const publicPhoto = await visitor(path + '/photo');
  assert.equal(publicPhoto.status, 200);
  assert.deepEqual(Buffer.from(await publicPhoto.arrayBuffer()), photo);
  assert.equal((await bob(path, patch({ acceptsFlowers: false }))).status, 404);
  assert.equal((await success(await alice(path))).garden.acceptsFlowers, true);

  await success(await alice(path, patch({ isPublic: false })));
  assert.deepEqual(await listedIds(visitor, '/api/public'), []);
  assert.equal((await visitor(path)).status, 404);
  assert.equal((await visitor(path + '/photo')).status, 404);
});

test('献花遵守公开和收花开关，同一请求并发重试及进程重启后只计一次', async (t) => {
  const site = await garden(t);
  const owner = site.browser(), guest = site.browser();
  await joinGarden(owner);
  const pet = await createGarden(owner, '小河');
  const path = '/api/gardens/' + pet.id, flowers = path + '/flowers';
  const requestId = crypto.randomUUID();
  assert.equal((await guest(flowers, post({ requestId }))).status, 404);
  await success(await owner(path, patch({ isPublic: true })));
  await success(await owner(path, patch({ acceptsFlowers: false })));
  assert.equal((await guest(flowers, post({ requestId }))).status, 403);
  assert.equal((await success(await owner(path))).garden.flowerCount, 0);
  await success(await owner(path, patch({ acceptsFlowers: true })));
  await Promise.all(Array.from({ length: 4 }, async () => {
    const { garden } = await success(await guest(flowers, post({ requestId })));
    assert.equal(garden.flowerCount, 1);
  }));

  // Stop the actual HTTP process; only files in the data directory and client cookies survive.
  await site.restart();
  assert.deepEqual(await listedIds(owner, '/api/mine'), [pet.id]);
  assert.deepEqual(await listedIds(guest, '/api/public'), [pet.id]);
  assert.equal((await success(await guest(path))).garden.flowerCount, 1);
  const restoredPhoto = await guest(path + '/photo');
  assert.equal(restoredPhoto.status, 200);
  assert.deepEqual(Buffer.from(await restoredPhoto.arrayBuffer()), photo);
  assert.equal((await success(await guest(flowers, post({ requestId })))).garden.flowerCount, 1);
  const second = await success(await guest(flowers, post({ requestId: crypto.randomUUID() })));
  assert.equal(second.garden.flowerCount, 2);
});

test('照片超限与伪图不建园，公开图片去除相机 EXIF 且禁止缓存', async (t) => {
  const site = await garden(t);
  const owner = site.browser(), visitor = site.browser();
  await joinGarden(owner);
  const upload = (bytes) => owner('/api/gardens', post({
    name: '柳叶', place: 'stone', story: '', photo: 'data:image/webp;base64,' + bytes.toString('base64'),
  }));
  const oversized = Buffer.alloc(1536 * 1024 + 1);
  photo.copy(oversized);
  assert.equal((await upload(oversized)).status, 413);
  assert.equal((await upload(Buffer.from('This file contains text instead of a picture.'))).status, 400);
  assert.deepEqual(await listedIds(owner, '/api/mine'), []);

  // Extend the fixture's VP8 frame with an EXIF chunk. The little-endian TIFF
  // contains a single Orientation tag with value 1, as a camera might export.
  assert.equal(photo.toString('ascii', 12, 16), 'VP8 ');
  const extended = Buffer.alloc(18);
  extended.write('VP8X');
  extended.writeUInt32LE(10, 4);
  extended[8] = 0x08;
  extended.writeUIntLE((photo.readUInt16LE(26) & 0x3fff) - 1, 12, 3);
  extended.writeUIntLE((photo.readUInt16LE(28) & 0x3fff) - 1, 15, 3);
  const metadata = Buffer.from('49492a0008000000010012010300010000000100000000000000', 'hex');
  const exif = Buffer.alloc(8);
  exif.write('EXIF');
  exif.writeUInt32LE(metadata.length, 4);
  const withExif = Buffer.concat([photo.subarray(0, 12), extended, photo.subarray(12), exif, metadata]);
  withExif.writeUInt32LE(withExif.length - 8, 4);
  const { garden: created } = await success(await upload(withExif));
  const path = '/api/gardens/' + created.id;
  await success(await owner(path, patch({ isPublic: true })));
  const publishedPhoto = await visitor(path + '/photo');
  assert.equal(publishedPhoto.status, 200);
  assert.match(publishedPhoto.headers.get('cache-control'), /\bno-store\b/);
  assert.deepEqual(Buffer.from(await publishedPhoto.arrayBuffer()), photo);
});

test('示例麦子归属独立，服务重建保留示例及已收花束', async (t) => {
  const site = await garden(t, { includeSample: true });
  const owner = site.browser(), visitor = site.browser();
  const id = 'demo-riverbend', path = '/api/gardens/' + id;
  assert.deepEqual(await listedIds(visitor, '/api/public'), [id]);
  const { garden: demo } = await success(await visitor(path));
  assert.equal(demo.name, '麦子');
  assert.equal(demo.acceptsFlowers, true);
  assert.equal(demo.isPublic, true);
  await joinGarden(owner);
  assert.deepEqual(await listedIds(owner, '/api/mine'), []);
  assert.equal((await owner(path, patch({ isPublic: false }))).status, 404);
  const created = await createGarden(owner, '小满');
  assert.deepEqual(await listedIds(owner, '/api/mine'), [created.id]);
  const response = await success(await visitor(path + '/flowers', post({ requestId: crypto.randomUUID() })));
  assert.equal(response.garden.flowerCount, demo.flowerCount + 1);
  await site.restart();
  assert.deepEqual(await listedIds(visitor, '/api/public'), [id]);
  assert.equal((await success(await visitor(path))).garden.flowerCount, response.garden.flowerCount);
  const demoPhoto = await visitor(path + '/photo');
  assert.equal(demoPhoto.status, 200);
  assert.deepEqual(Buffer.from(await demoPhoto.arrayBuffer()), photo);
  assert.deepEqual(await listedIds(owner, '/api/mine'), [created.id]);
});

test('建园请求按主人去重，并发与重启重试返回同一档案', async (t) => {
  const site = await garden(t);
  const alice = site.browser(), bob = site.browser();
  await joinGarden(alice);
  await joinGarden(bob);
  const data = { name: '风铃', story: '', place: 'stone', photo: photoDataUrl, clientRequestId: crypto.randomUUID() };
  const create = async (client) => (await success(await client('/api/gardens', post(data)))).garden;
  const results = await Promise.all(Array.from({ length: 3 }, () => create(alice)));
  const first = results[0];
  assert.ok(first.id);
  assert.ok(results.every(({ id }) => id === first.id));
  assert.deepEqual(await listedIds(alice, '/api/mine'), [first.id]);
  const second = await create(bob);
  assert.notEqual(second.id, first.id);
  assert.deepEqual(await listedIds(bob, '/api/mine'), [second.id]);
  await site.restart();
  assert.equal((await create(alice)).id, first.id);
  assert.equal((await create(bob)).id, second.id);
  assert.deepEqual(await listedIds(alice, '/api/mine'), [first.id]);
  assert.deepEqual(await listedIds(bob, '/api/mine'), [second.id]);
});

test('升级旧库后原主人可恢复私密档案、照片和礼物，并可创建新档案', async (t) => {
  const ownerId = crypto.randomUUID(), gardenId = crypto.randomUUID();
  const key = randomBytes(32).toString('base64url');
  // Build the previous schema directly, before starting the new service for the first time.
  const site = await garden(t, { includeSample: true, prepare(dataDir) {
    const legacy = new DatabaseSync(join(dataDir, 'memorials.sqlite'));
    try {
      legacy.exec(`
        CREATE TABLE owners(id TEXT PRIMARY KEY, recovery_hash BLOB NOT NULL UNIQUE);
        CREATE TABLE sessions(hash BLOB PRIMARY KEY, owner TEXT NOT NULL REFERENCES owners(id), expires INTEGER NOT NULL);
        CREATE TABLE gardens(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES owners(id),
          name TEXT NOT NULL, story TEXT NOT NULL, place TEXT NOT NULL, photo BLOB NOT NULL,
          is_public INTEGER NOT NULL DEFAULT 0, accepts_flowers INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE flowers(garden TEXT NOT NULL REFERENCES gardens(id), request TEXT NOT NULL, PRIMARY KEY(garden,request));
      `);
      legacy.prepare('INSERT INTO owners VALUES (?,?)').run(ownerId, createHash('sha256').update(key).digest());
      legacy.prepare('INSERT INTO gardens VALUES (?,?,?,?,?,?,0,0)').run(gardenId, ownerId, '旧时月', '最爱听晚风。', 'entrance', photo);
      legacy.prepare('INSERT INTO flowers VALUES (?,?)').run(gardenId, crypto.randomUUID());
    } finally {
      legacy.close();
    }
  } });
  const owner = site.browser(), visitor = site.browser();
  const path = '/api/gardens/' + gardenId;
  assert.equal((await visitor(path)).status, 404);
  assert.deepEqual(await listedIds(visitor, '/api/public'), ['demo-riverbend']);
  const restored = await success(await owner('/api/restore', post({ key })));
  assert.equal(restored.owner, true);
  assert.deepEqual(await listedIds(owner, '/api/mine'), [gardenId]);
  const old = (await success(await owner(path))).garden;
  assert.equal(old.name, '旧时月');
  assert.equal(old.story, '最爱听晚风。');
  assert.equal(old.isPublic, false);
  assert.equal(old.acceptsFlowers, false);
  assert.equal(old.flowerCount, 1);
  assert.equal(old.place, 'entrance');
  const image = await owner(path + '/photo');
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), photo);
  const request = post({ name: '新芽', place: 'stone', photo: photoDataUrl, clientRequestId: crypto.randomUUID() });
  const added = (await success(await owner('/api/gardens', request))).garden;
  assert.equal((await success(await owner('/api/gardens', request))).garden.id, added.id);
  assert.deepEqual(await listedIds(owner, '/api/mine'), [added.id, gardenId].sort());
});

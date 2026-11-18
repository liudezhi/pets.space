import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createMemorialApi } from '../server/memorial-api.mjs';

// Solid-colour 2×2 WebP preview and a separately encoded 3×3 PNG original.
const preview = 'UklGRiwAAABXRUJQVlA4ICAAAABQAQCdASoCAAIAAgA0JYwABAAAAP7w4DfoaNPvQIAAAA==';
const original = 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAF0lEQVQI12Ocs34DAwMDAwMDEwMMIFgAN9gCAWM8B5kAAAAASUVORK5CYII=';
const photo = 'data:image/webp;base64,' + preview;
const albumInput = { mime: 'image/png', original, preview: photo };
const inviteCode = 'legacy-test-invite';

async function gardenSite(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'pets-legacy-care-'));
  const api = createMemorialApi({ dataDir, inviteCode });
  const server = createServer((req, res) => api(req, res, () => res.writeHead(404).end()));
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    api.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  function browser() {
    const cookies = new Map();
    return async (path, input, method = input === undefined ? 'GET' : 'POST') => {
      const response = await fetch(origin + path, {
        method,
        headers: { origin, 'content-type': 'application/json', cookie: [...cookies.values()].join('; ') },
        body: input === undefined ? undefined : JSON.stringify(input),
      });
      for (const line of response.headers.getSetCookie()) {
        const pair = line.split(';')[0];
        cookies.set(pair.split('=')[0], pair);
      }
      return response;
    };
  }
  return { browser, databasePath: join(dataDir, 'memorials.sqlite') };
}

async function json(response) {
  const result = await response.json();
  assert.ok(response.ok, response.status + ' ' + JSON.stringify(result));
  return result;
}

async function purchase(client, product, fields = {}) {
  await json(await client('/api/session'));
  const { order } = await json(await client('/api/orders', { product, requestId: randomUUID(), ...fields }));
  return json(await client('/api/orders/' + order.id + '/pay', {}));
}

async function newGarden(owner, story = '') {
  await purchase(owner, 'foundation', { inviteCode });
  const { garden } = await json(await owner('/api/gardens', { name: '青禾', story, place: 'stone', photo }));
  return '/api/gardens/' + garden.id;
}

async function exported(client, path) {
  const response = await client(path + '/archive');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.match(response.headers.get('content-disposition'), /^attachment;/);
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await response.text();
  const data = html.match(/href="data:application\/json;base64,([A-Za-z0-9+/=]+)"/);
  assert.ok(data, 'offline export has a downloadable JSON record');
  return { html, record: JSON.parse(Buffer.from(data[1], 'base64').toString('utf8')) };
}

test('原图可逐字节取回，公开视角只能读取授权的分享图', async t => {
  const { browser } = await gardenSite(t);
  const owner = browser(), guest = browser();
  const story = '记得河边的 <草甸> 与你 & 我。';
  const path = await newGarden(owner, story);
  const album = path + '/album';
  const added = (await json(await owner(album, albumInput))).photos;
  assert.equal(added.length, 1);
  const url = added[0].previewUrl;
  const retry = (await json(await owner(album, albumInput))).photos;
  assert.deepEqual(retry.map(image => image.id), [added[0].id]);
  assert.equal((await guest(url)).status, 404);
  await json(await owner(path, { isPublic: true }, 'PATCH'));
  assert.deepEqual((await json(await guest(album))).photos, []);
  assert.equal((await guest(url)).status, 404);
  assert.equal((await guest(url, { isPublic: true }, 'PATCH')).status, 404);
  await json(await owner(url, { isPublic: true }, 'PATCH'));
  const publicPhotos = (await json(await guest(album))).photos;
  assert.deepEqual(publicPhotos.map(item => item.id), [added[0].id]);
  assert.ok(!JSON.stringify(publicPhotos).includes(original));
  const shared = await guest(url);
  assert.equal(shared.status, 200);
  assert.equal(shared.headers.get('content-type'), 'image/webp');
  assert.deepEqual(Buffer.from(await shared.arrayBuffer()), Buffer.from(preview, 'base64'));
  assert.equal((await guest(path + '/archive')).status, 404);
  const { html, record } = await exported(owner, path);
  const png = html.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
  assert.ok(png, 'original image should be downloadable from the offline HTML');
  const extracted = Buffer.from(png[1], 'base64');
  assert.deepEqual(extracted, Buffer.from(original, 'base64'));
  assert.equal(record.photos[0].sha256, createHash('sha256').update(extracted).digest('hex'));
  assert.equal(record.photos[0].mime, 'image/png');
  assert.equal(record.story, story);
  assert.equal(record.photos[0].isPublic, true);
  assert.equal(record.views[0].id, 'stone');
  assert.equal(record.sceneVersion, 'riverbend-1');
  assert.deepEqual(record.plot, { page: 0, slot: 0 });
  assert.ok(html.includes('&lt;草甸&gt;') && html.includes('&amp;'));
  assert.doesNotMatch(html, /<script\b|<草甸>/i);
  await json(await owner(path, { isPublic: false }, 'PATCH'));
  assert.equal((await guest(url)).status, 404);
  assert.equal((await guest(album)).status, 404);
  assert.equal((await owner(url)).status, 200);
});

test('花园转为私密后许愿树撤下寄语；过期的礼物和免费花束仍保存在导出记录', async t => {
  const { browser } = await gardenSite(t);
  const owner = browser(), guest = browser();
  const path = await newGarden(owner);
  const gardenId = path.split('/').at(-1);
  await json(await owner(path, { isPublic: true }, 'PATCH'));
  const wishes = path + '/wishes';
  const publicWish = { message: '风起时想起你。', isPublic: true, requestId: randomUUID() };
  const privateWish = { message: '只写给你的回忆。', isPublic: false, requestId: randomUUID() };
  await json(await owner(wishes, publicWish));
  await json(await owner(wishes, privateWish));
  await json(await owner(wishes, publicWish));
  const publicMessages = async () => (await json(await guest('/api/wishes'))).wishes.map(item => item.message);
  assert.deepEqual(await publicMessages(), [publicWish.message]);
  assert.equal((await guest(wishes)).status, 404);
  const first = { requestId: randomUUID() };
  await json(await guest(path + '/flowers', first));
  await json(await guest(path + '/flowers', first));
  await json(await guest(path + '/flowers', { requestId: randomUUID() }));
  const { order: lily } = await purchase(guest, 'lily', { gardenId });
  const { order: vase } = await purchase(guest, 'vase', { gardenId });
  await json(await owner(path, { isPublic: false }, 'PATCH'));
  assert.deepEqual(await publicMessages(), []);
  t.mock.method(Date, 'now', () => Date.parse(lily.paidAt) + 8 * 86400_000);
  assert.deepEqual((await json(await owner(path))).garden.gifts.map(gift => gift.type), ['vase']);
  const { record } = await exported(owner, path);
  assert.deepEqual(record.wishes.map(item => item.message).sort(), [publicWish.message, privateWish.message].sort());
  assert.equal(record.flowers.length, 2);
  assert.ok(record.flowers.every(item => Number.isFinite(Date.parse(item.placedAt))));
  assert.deepEqual(record.gifts.map(item => item.type).sort(), ['lily', 'vase']);
  assert.equal(record.gifts.find(item => item.type === 'vase').placedAt, vase.paidAt);
  const oldLily = record.gifts.find(item => item.type === 'lily');
  assert.equal(oldLily.placedAt, lily.paidAt);
  assert.ok(Date.parse(oldLily.expiresAt) < Date.now());
});

test('指定接收人才可接管，移交后双方权限更新，确认删除会清理关联资料', async t => {
  const { browser, databasePath } = await gardenSite(t);
  const owner = browser(), family = browser(), neighbor = browser(), guest = browser();
  const path = await newGarden(owner);
  const id = path.split('/').at(-1);
  await purchase(family, 'foundation', { inviteCode });
  await purchase(neighbor, 'foundation', { inviteCode });
  const { recipient } = await json(await family('/api/care/identity'));
  const originalOwner = (await json(await owner('/api/care/identity'))).recipient;
  const album = (await json(await owner(path + '/album', albumInput))).photos[0];
  await json(await owner(album.previewUrl, { isPublic: true }, 'PATCH'));
  await json(await owner(path, { isPublic: true }, 'PATCH'));
  await json(await guest(path + '/flowers', { requestId: randomUUID() }));
  await json(await owner(path + '/wishes', { message: '记得你的四季。', isPublic: true, requestId: randomUUID() }));
  const { code } = await json(await owner(path + '/handover', { recipient }));
  assert.equal((await neighbor('/api/care/accept', { code })).status, 404);
  assert.equal((await owner('/api/care/accept', { code })).status, 404);
  assert.equal((await json(await family('/api/care/accept', { code }))).id, id);
  assert.equal((await family('/api/care/accept', { code })).status, 404);
  assert.equal((await owner(path)).status, 404);
  assert.equal((await owner(path + '/archive')).status, 404);
  assert.equal((await owner(path + '/record', { confirmName: '青禾' })).status, 404);
  assert.equal((await guest(album.previewUrl)).status, 404);
  const transferred = (await json(await family(path))).garden;
  assert.equal(transferred.isPublic, false);
  assert.equal(transferred.isOwner, true);
  assert.ok(!(await json(await owner('/api/mine'))).gardens.some(garden => garden.id === id));
  assert.equal((await exported(family, path)).record.flowers.length, 1);
  await json(await family(path + '/handover', { recipient: originalOwner }));
  assert.equal((await family(path + '/record', { confirmName: '别的名字' })).status, 400);
  await json(await family(path + '/record', { confirmName: '青禾' }));
  for (const gone of [path, path + '/archive', album.previewUrl, path + '/wishes']) {
    assert.equal((await family(gone)).status, 404);
  }
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    for (const table of ['archive_photos','wishes','handovers','flowers','flower_dates']) {
      assert.equal(db.prepare('SELECT count(*) AS n FROM ' + table + ' WHERE garden=?').get(id).n, 0, table);
    }
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { db.close(); }
});

test('建园及原件在同一事务写入，按展示位分页、转私密与退出遵守访问权限',async t=>{
  const {browser}=await gardenSite(t);
  const owner=browser(), guest=browser();
  await purchase(owner,'foundation',{inviteCode});
  const gardens=[];
  for(let i=0;i<7;i++){
    const {garden}=await json(await owner('/api/gardens',{name:'成员'+i,story:'',photo,place:'stone',
      originalFile:i===0?{mime:'image/png',original}:undefined}));
    gardens.push(garden);
    if(i!==2)await json(await owner('/api/gardens/'+garden.id,{isPublic:true},'PATCH'));
  }
  const base='/api/gardens/'+gardens[0].id;
  const html=(await exported(owner,base)).html;
  assert.ok(html.includes(original));
  assert.deepEqual((await json(await guest(base+'/album'))).photos,[]);
  const first=await json(await guest('/api/neighborhoods'));
  assert.equal(first.gardens.length,5);assert.equal(first.next,1);
  assert.ok(!first.gardens.some(g=>g.id===gardens[2].id));
  const second=await json(await guest('/api/neighborhoods?page=1'));
  assert.equal(second.previous,0);assert.equal(second.gardens[0].id,gardens[6].id);
  await json(await owner(base,{isPublic:false},'PATCH'));
  const changed=await json(await guest('/api/neighborhoods'));
  assert.deepEqual(changed.gardens,first.gardens.slice(1));
  await json(await owner('/api/sign-out',{}));
  assert.equal((await owner(base+'/archive')).status,404);
});

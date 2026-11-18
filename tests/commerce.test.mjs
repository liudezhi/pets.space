import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMemorialApi } from '../server/memorial-api.mjs';

const photo = await readFile(new URL('../public/pet.webp', import.meta.url));
const photoUrl = 'data:image/webp;base64,' + photo.toString('base64');
const requestId = () => crypto.randomUUID();

async function shop(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'pets-space-commerce-'));
  const api = createMemorialApi({ dataDir, inviteCode: 'invite', samplePhoto: photo });
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
  return function browser(jar = new Map()) {
    const client = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
      const response = await fetch(origin + path, {
        method,
        headers: { 'content-type': 'application/json', origin, cookie: [...jar.values()].join('; ') },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0];
        jar.set(pair.split('=')[0], pair);
      }
      return { status: response.status, body: await response.json() };
    };
    client.copy = () => browser(new Map(jar));
    return client;
  };
}

function value(result, status) {
  if (status === undefined) {
    assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result));
  } else {
    assert.equal(result.status, status, JSON.stringify(result));
  }
  return result.body;
}

async function openShop(client) {
  value(await client('/api/session'));
}

async function placeOrder(client, product, fields = {}) {
  const input = { product, requestId: requestId(), ...fields };
  return value(await client('/api/orders', input)).order;
}

function pay(client, order) {
  return client('/api/orders/' + order.id + '/pay', {});
}

async function ownerAccount(client) {
  await openShop(client);
  const base = await placeOrder(client, 'foundation', { inviteCode: 'invite' });
  return value(await pay(client, base));
}

async function memorial(client, name) {
  return value(await client('/api/gardens', { name, place: 'stone', story: '', photo: photoUrl })).garden;
}

test('基础单可暂停后恢复；付款前不能建园，跨浏览器不可读单或付款', async (t) => {
  const fresh = await shop(t), buyer = fresh(), stranger = fresh();
  await openShop(buyer);
  await openShop(stranger);
  const create = () => buyer('/api/gardens', { name: '晨星', place: 'stone', photo: photoUrl });
  assert.equal((await create()).status, 401);
  assert.equal((await buyer('/api/session', { code: 'invite' })).status, 410);
  const fields = { product: 'foundation', inviteCode: 'invite', requestId: requestId() };
  const placed = await Promise.all([buyer('/api/orders', fields), buyer('/api/orders', fields)]);
  const [order, duplicate] = placed.map((result) => value(result).order);
  assert.equal(order.id, duplicate.id);
  assert.equal(order.status, 'pending');
  assert.equal((await buyer('/api/orders', { ...fields, requestId: requestId() })).status, 409);
  assert.equal(order.amountFen, 3900);
  assert.equal(order.currency, 'CNY');
  assert.equal(order.mode, 'sandbox');
  assert.equal(value(await buyer('/api/session')).owner, false);
  assert.equal((await create()).status, 401);
  assert.equal((await stranger('/api/orders/' + order.id)).status, 404);
  assert.equal((await pay(stranger, order)).status, 404);
  assert.deepEqual(value(await stranger('/api/orders')).orders, []);
  const listing = value(await buyer('/api/orders')).orders;
  assert.deepEqual(listing.map((item) => item.id), [order.id]);
  const resumed = value(await buyer('/api/orders/' + order.id)).order;
  assert.equal(resumed.status, 'pending');
  const paid = value(await pay(buyer, resumed));
  assert.equal(paid.owner, true);
  assert.equal(paid.order.status, 'paid');
  assert.ok(paid.order.paidAt);
  assert.ok(paid.recoveryKey);
  assert.equal(value(await buyer('/api/session')).owner, true);
  const pet = value(await create()).garden;
  const retried = value(await pay(buyer, order));
  assert.equal(retried.order.id, order.id);
  assert.equal(retried.order.paidAt, paid.order.paidAt);
  assert.deepEqual(value(await buyer('/api/mine')).gardens.map(({ id }) => id), [pet.id]);
  const recovery = value(await stranger('/api/restore', { key: paid.recoveryKey }));
  assert.equal(recovery.owner, true);
  assert.deepEqual(value(await stranger('/api/mine')).gardens.map(({ id }) => id), [pet.id]);
  const nextDevice = fresh();
  assert.equal((await nextDevice('/api/restore', { key: paid.recoveryKey })).status, 401);
});

test('访客模拟购买礼物须经园主准许；关闭收礼后待付单不能发货，重试不多发', async (t) => {
  const fresh = await shop(t), owner = fresh(), guest = fresh(), other = fresh();
  await ownerAccount(owner);
  await openShop(guest);
  await openShop(other);
  const pet = await memorial(owner, '茉莉');
  const path = '/api/gardens/' + pet.id;
  const gift = (product = 'lily') => ({ product, gardenId: pet.id, requestId: requestId() });
  assert.equal((await guest('/api/orders', gift())).status, 404);
  value(await owner(path, { isPublic: true }, 'PATCH'));
  const lily = value(await guest('/api/orders', gift())).order;
  assert.equal(lily.amountFen, 600);
  assert.equal(lily.gardenId, pet.id);
  value(await owner(path, { acceptsFlowers: false }, 'PATCH'));
  assert.equal((await guest('/api/orders', gift('vase'))).status, 403);
  assert.equal((await pay(guest, lily)).status, 403);
  assert.equal(value(await guest('/api/orders/' + lily.id)).order.status, 'pending');
  assert.deepEqual(value(await guest(path)).garden.gifts, []);
  value(await owner(path, { acceptsFlowers: true }, 'PATCH'));
  assert.equal((await pay(other, lily)).status, 404);
  const [one, two] = await Promise.all([pay(guest, lily), pay(guest, lily)]);
  assert.equal(value(one).order.id, value(two).order.id);
  const vase = await placeOrder(guest, 'vase', { gardenId: pet.id });
  assert.equal(vase.amountFen, 1800);
  value(await pay(guest, vase));
  const gifts = value(await guest(path)).garden.gifts;
  assert.deepEqual(gifts.map(({ type }) => type).sort(), ['lily', 'vase']);
  assert.ok(gifts.every(({ id, placedAt }) => id && Date.parse(placedAt)));
  const lilyGift = gifts.find(({ type }) => type === 'lily');
  const expires = Date.parse(lilyGift.expiresAt);
  assert.equal(expires - Date.parse(lilyGift.placedAt), 7 * 24 * 60 * 60 * 1000);
  assert.equal(gifts.find(({ type }) => type === 'vase').expiresAt, null);
  assert.equal(value(await guest('/api/session')).owner, false);
  t.mock.method(Date, 'now', () => expires + 1);
  assert.deepEqual(value(await guest(path)).garden.gifts.map(({ type }) => type), ['vase']);
  assert.equal(value(await guest('/api/orders/' + lily.id)).order.status, 'paid');
});

test('家庭庭院只可归档自己的多只宠物，公开庭院随各宠物可见性和移出操作更新', async (t) => {
  const fresh = await shop(t), owner = fresh(), neighbor = fresh(), guest = fresh();
  await ownerAccount(owner);
  await ownerAccount(neighbor);
  await openShop(guest);
  const a = await memorial(owner, '果果'), b = await memorial(owner, '朵朵');
  const other = await memorial(neighbor, '小满');
  const pathA = '/api/gardens/' + a.id, pathB = '/api/gardens/' + b.id;
  assert.equal(value(await owner('/api/courtyard')).courtyard, null);
  const order = await placeOrder(owner, 'courtyard');
  assert.equal(order.amountFen, 8800);
  const paid = value(await pay(owner, order));
  assert.ok(paid.courtyard.id);
  const yard = value(await owner('/api/courtyard')).courtyard;
  assert.equal(yard.id, paid.courtyard.id);
  assert.equal(value(await neighbor('/api/courtyard')).courtyard, null);
  value(await owner(pathA, { isPublic: true, inCourtyard: true }, 'PATCH'));
  value(await owner(pathB, { inCourtyard: true }, 'PATCH'));
  assert.equal((await owner('/api/gardens/' + other.id, { inCourtyard: true }, 'PATCH')).status, 404);
  const ids = [a.id, b.id].sort();
  assert.deepEqual(value(await owner('/api/courtyard')).courtyard.gardenIds.sort(), ids);
  const shared = '/api/courtyards/' + yard.id;
  assert.deepEqual(value(await owner(shared)).gardens.map(({ id }) => id).sort(), ids);
  const outside = value(await guest(shared));
  assert.deepEqual(outside.courtyard.gardenIds, [a.id]);
  assert.deepEqual(outside.gardens.map(({ id }) => id), [a.id]);
  assert.equal(value(await guest(pathA)).garden.courtyard.id, yard.id);
  value(await owner(pathA, { inCourtyard: false }, 'PATCH'));
  assert.equal(value(await owner(pathA)).garden.courtyard, null);
  assert.deepEqual(value(await owner('/api/courtyard')).courtyard.gardenIds, [b.id]);
  assert.equal(value(await pay(owner, order)).courtyard.id, yard.id);
});

test('基础付款响应丢失时可凭原购买会话重领；换设备轮换钥匙后旧订单不再签入', async (t) => {
  const fresh = await shop(t), buyer = fresh(), newDevice = fresh();
  await openShop(buyer);
  const order = await placeOrder(buyer, 'foundation', { inviteCode: 'invite' });
  // Only the observation client sees the first receipt. The buyer keeps its pre-payment cookie jar.
  const observation = buyer.copy(), prePayment = buyer.copy();
  const lostReceipt = value(await pay(observation, order));
  assert.ok(lostReceipt.recoveryKey);
  assert.equal(value(await buyer('/api/session')).owner, false);
  assert.equal((await buyer('/api/mine')).status, 401);
  assert.equal(value(await buyer('/api/orders/' + order.id)).order.status, 'paid');

  const retry = value(await pay(buyer, order));
  assert.equal(retry.recoveryKey, lostReceipt.recoveryKey);
  assert.equal(retry.order.paidAt, lostReceipt.order.paidAt);
  assert.equal(value(await buyer('/api/session')).owner, true);
  const pet = await memorial(buyer, '云雀');
  const restored = value(await newDevice('/api/restore', { key: retry.recoveryKey }));
  assert.ok(restored.recoveryKey);
  assert.notEqual(restored.recoveryKey, retry.recoveryKey);
  assert.deepEqual(value(await newDevice('/api/mine')).gardens.map(({ id }) => id), [pet.id]);

  const stale = value(await pay(prePayment, order));
  assert.equal(stale.order.status, 'paid');
  assert.equal(stale.owner, false);
  assert.equal(stale.recoveryKey, undefined);
  assert.equal(value(await prePayment('/api/session')).owner, false);
  assert.equal((await prePayment('/api/mine')).status, 401);
  assert.equal((await prePayment('/api/restore', { key: retry.recoveryKey })).status, 401);
});

test('共享浏览器更换园主时隔离原购买记录', async (t) => {
  const fresh = await shop(t), shared = fresh(), other = fresh();
  await ownerAccount(shared);
  const recipient = await ownerAccount(other);
  const pending = await placeOrder(shared, 'courtyard');
  value(await shared('/api/restore', { key: recipient.recoveryKey }));
  assert.deepEqual(value(await shared('/api/orders')).orders, []);
  assert.equal((await shared('/api/orders/' + pending.id)).status, 404);
  assert.equal((await pay(shared, pending)).status, 404);
  assert.equal(value(await shared('/api/courtyard')).courtyard, null);
});

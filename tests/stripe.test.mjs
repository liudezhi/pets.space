import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMemorialApi } from '../server/memorial-api.mjs';

const origin = 'https://pets.example';
const stripeKey = 'sk_test_local_contract_only';
const hookKey = 'whsec_local_contract_only';
const samplePhoto = await readFile(new URL('../public/pet.webp', import.meta.url));

async function setup(t, fetchPayment, mode = 'stripe-test') {
  const dataDir = await mkdtemp(join(tmpdir(), 'pets-stripe-fixture-'));
  function open(mode) {
    const payment = mode === 'sandbox' ? { mode, fetch: fetchPayment } : {
      mode, secretKey: stripeKey, webhookSecret: hookKey, publicOrigin: origin, fetch: fetchPayment,
    };
    return createMemorialApi({ dataDir, inviteCode: 'test-invite', samplePhoto, payment });
  }
  let api = open(mode);
  const server = createServer((req, res) => api(req, res, () => res.writeHead(404).end()));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const localOrigin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
    api.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  function browser() {
    const cookies = new Map();
    return async (path, body, method = body === undefined ? 'GET' : 'POST') => {
      const res = await fetch(localOrigin + path, {
        method,
        headers: { origin: localOrigin, 'content-type': 'application/json', cookie: [...cookies.values()].join('; ') },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const token of res.headers.getSetCookie()) {
        const pair = token.split(';')[0];
        cookies.set(pair.split('=')[0], pair);
      }
      return { status: res.status, body: await res.json() };
    };
  }
  return { browser, localOrigin, switchMode(next) { api.close(); api = open(next); } };
}

function ok(response) {
  assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response));
  return response.body;
}

async function orderFor(client, product = 'foundation') {
  ok(await client('/api/session'));
  const fields = product === 'foundation' ? { inviteCode: 'test-invite' } : { gardenId: 'demo-riverbend' };
  return ok(await client('/api/orders', { product, requestId: randomUUID(), ...fields })).order;
}

function signedBody(event, { timestamp = Math.floor(Date.now() / 1000), secret = hookKey } = {}) {
  const raw = JSON.stringify(event);
  const hmac = createHmac('sha256', secret).update(timestamp + '.' + raw).digest('hex');
  return { raw, signature: 't=' + timestamp + ',v1=' + hmac };
}

function testProvider() {
  const calls = [];
  async function fetchPayment(url, init) {
    assert.equal(String(url), 'https://api.stripe.com/v1/checkout/sessions');
    assert.equal(init.method, 'POST');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer ' + stripeKey);
    const fields = new URLSearchParams(init.body);
    const id = 'cs_test_' + (calls.length + 1);
    const session = {
      id, object: 'checkout.session', mode: 'payment', status: 'open', livemode: false,
      url: 'https://checkout.stripe.com/c/pay/' + id,
    };
    calls.push({ fields, headers, session });
    return Response.json(session);
  }
  return { calls, fetchPayment };
}

function notification(order, session, changes = {}) {
  return {
    id: 'evt_' + randomUUID().replaceAll('-', ''), object: 'event',
    type: 'checkout.session.completed', livemode: false,
    data: { object: {
      ...session, client_reference_id: order.id, metadata: { order_id: order.id, product: order.product, mode: order.mode },
      currency: 'cny', amount_total: order.amountFen, payment_status: 'paid', status: 'complete', ...changes,
    } },
  };
}

async function deliver(site, event, options, edit = (raw) => raw) {
  const signed = signedBody(event, options);
  const response = await fetch(site.localOrigin + '/api/payments/stripe/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signed.signature },
    body: edit(signed.raw),
  });
  return response.status;
}

test('Stripe 测试结算按服务端订单计价，已验签付款只发放一次，原购买会话可领取', async (t) => {
  const provider = testProvider();
  const site = await setup(t, provider.fetchPayment);
  const owner = site.browser(), stranger = site.browser();
  const order = await orderFor(owner);
  assert.equal(order.mode, 'stripe-test');
  const path = '/api/orders/' + order.id, payPath = path + '/pay';
  const checkout = ok(await owner(payPath, {}));
  assert.equal(checkout.order.status, 'pending');
  assert.equal(checkout.owner, false);
  assert.equal(checkout.checkoutUrl, provider.calls[0].session.url);
  const { fields, session } = provider.calls[0];
  assert.equal(fields.get('mode'), 'payment');
  assert.equal(fields.get('client_reference_id'), order.id);
  assert.equal(fields.get('metadata[order_id]'), order.id);
  assert.equal(fields.get('metadata[product]'), order.product);
  assert.equal(fields.get('metadata[mode]'), order.mode);
  assert.equal(fields.get('line_items[0][price_data][currency]'), 'cny');
  assert.equal(fields.get('line_items[0][price_data][unit_amount]'), '3900');
  assert.equal(fields.get('line_items[0][quantity]'), '1');
  assert.equal(new URL(fields.get('success_url')).origin, origin);
  assert.equal(new URL(fields.get('cancel_url')).origin, origin);
  assert.ok(provider.calls[0].headers.get('idempotency-key'));
  assert.equal(ok(await owner(payPath, {})).checkoutUrl, checkout.checkoutUrl);
  assert.equal(provider.calls.length, 1);
  assert.equal((await owner('/api/mine')).status, 401);
  ok(await stranger('/api/session'));
  assert.equal((await stranger(payPath, {})).status, 404);

  const paid = notification(order, session);
  assert.equal(await deliver(site, paid), 200);
  const receipt = ok(await owner(path)).order;
  assert.equal(receipt.status, 'paid');
  assert.ok(receipt.paidAt);
  assert.equal(await deliver(site, paid), 200);
  const asyncPaid = { ...paid, id: 'evt_' + randomUUID().replaceAll('-', ''), type: 'checkout.session.async_payment_succeeded' };
  assert.equal(await deliver(site, asyncPaid), 200);
  assert.equal(ok(await owner(path)).order.paidAt, receipt.paidAt);
  assert.equal((await stranger(payPath, {})).status, 404);
  const claimed = ok(await owner(payPath, {}));
  assert.equal(claimed.owner, true);
  assert.ok(claimed.recoveryKey);
  assert.equal(ok(await owner('/api/session')).owner, true);
  assert.equal(ok(await owner(payPath, {})).recoveryKey, claimed.recoveryKey);
  assert.equal(provider.calls.length, 1);
});

test('验签、时间窗和订单对账拒绝不匹配通知，之后正确通知仍可完成原单', async (t) => {
  const provider = testProvider();
  const site = await setup(t, provider.fetchPayment);
  const buyer = site.browser(), order = await orderFor(buyer);
  const path = '/api/orders/' + order.id;
  ok(await buyer(path + '/pay', {}));
  const session = provider.calls[0].session;
  const event = notification(order, session);
  const now = Math.floor(Date.now() / 1000);
  for (const settings of [{ secret: 'different-test-secret' }, { timestamp: now - 3600 }, { timestamp: now + 3600 }]) {
    assert.ok((await deliver(site, event, settings)) >= 400);
  }
  // Even harmless whitespace changes the signed bytes.
  assert.ok((await deliver(site, event, {}, (raw) => raw + '\n')) >= 400);
  const variations = [
    { id: 'cs_test_unknown' }, { amount_total: order.amountFen + 1 }, { currency: 'usd' },
    { livemode: true }, { mode: 'subscription' }, { client_reference_id: randomUUID() },
    { metadata: { ...event.data.object.metadata, product: 'vase' } },
    { metadata: { ...event.data.object.metadata, mode: 'sandbox' } },
    { metadata: { ...event.data.object.metadata, order_id: randomUUID() } },
  ];
  for (const changes of variations) {
    const outcome = await deliver(site, notification(order, session, changes));
    assert.ok(outcome >= 400, JSON.stringify({ changes, outcome }));
  }
  assert.ok((await deliver(site, { ...event, livemode: true })) >= 400);
  await deliver(site, notification(order, session, { payment_status: 'unpaid' }));
  assert.equal(ok(await buyer(path)).order.status, 'pending');
  assert.equal(ok(await buyer('/api/session')).owner, false);
  assert.equal(await deliver(site, event), 200);
  assert.equal(ok(await buyer(path)).order.status, 'paid');
});

test('Stripe 过期结算可重开，新会话回调只放置一份礼物', async (t) => {
  const provider = testProvider();
  const site = await setup(t, provider.fetchPayment);
  const buyer = site.browser(), order = await orderFor(buyer, 'lily');
  const path = '/api/orders/' + order.id, demo = '/api/gardens/demo-riverbend';
  ok(await buyer(path + '/pay', {}));
  const original = provider.calls[0].session;
  const expired = notification(order, original, { payment_status: 'unpaid', status: 'expired' });
  expired.type = 'checkout.session.expired';
  assert.equal(await deliver(site, expired), 200);
  assert.equal(await deliver(site, expired), 200);
  assert.equal(ok(await buyer(path)).order.status, 'pending');
  const second = ok(await buyer(path + '/pay', {}));
  assert.equal(provider.calls.length, 2);
  assert.notEqual(second.checkoutUrl, original.url);
  assert.notEqual(provider.calls[0].headers.get('idempotency-key'), provider.calls[1].headers.get('idempotency-key'));
  assert.equal(await deliver(site, expired), 200);
  assert.equal(await deliver(site, notification(order, original)), 409);
  assert.equal(ok(await buyer(path)).order.status, 'pending');
  const notification2 = notification(order, provider.calls[1].session);
  assert.equal(await deliver(site, notification2), 200);
  assert.equal(await deliver(site, notification2), 200);
  const garden = ok(await buyer(demo)).garden;
  assert.deepEqual(garden.gifts.map(({ type }) => type), ['lily']);
  assert.equal(ok(await buyer('/api/session')).owner, false);
});

test('sandbox 只支持本地模拟支付，Stripe 通知不能改变模拟订单', async (t) => {
  let calls = 0;
  const site = await setup(t, async () => {
    calls++;
    throw new Error('Sandbox cannot open a hosted checkout');
  }, 'sandbox');
  const buyer = site.browser(), order = await orderFor(buyer);
  const path = '/api/orders/' + order.id;
  assert.equal(order.mode, 'sandbox');
  const signed = notification(order, { id: 'cs_test_sandbox', object: 'checkout.session', mode: 'payment', livemode: false });
  assert.ok((await deliver(site, signed)) >= 400);
  assert.equal(ok(await buyer(path)).order.status, 'pending');
  assert.equal(ok(await buyer(path + '/pay', {})).order.status, 'paid');
  assert.equal(calls, 0);
});

test('同一数据库切回 sandbox 后不能模拟结清 Stripe 待付订单', async (t) => {
  const provider = testProvider();
  const site = await setup(t, provider.fetchPayment);
  const buyer = site.browser(), order = await orderFor(buyer), path = '/api/orders/' + order.id;
  ok(await buyer(path + '/pay', {}));
  site.switchMode('sandbox');
  const prior = ok(await buyer(path)).order;
  assert.equal(prior.mode, 'stripe-test');
  assert.ok((await buyer(path + '/pay', {})).status >= 400);
  assert.equal(ok(await buyer(path)).order.status, 'pending');
  assert.equal(ok(await buyer('/api/session')).owner, false);
  site.switchMode('stripe-test');
  assert.equal(await deliver(site, notification(order, provider.calls[0].session)), 200);
  assert.ok(ok(await buyer(path + '/pay', {})).recoveryKey);
});

test('错误支付配置拒绝启动，不能降级为模拟付款', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'pets-stripe-invalid-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const base = { mode: 'stripe-test', publicOrigin: origin, secretKey: stripeKey, webhookSecret: hookKey,
    fetch: async () => { throw new Error('No payment fetch during validation'); } };
  for (const invalid of [
    { mode: 'unknown' }, { mode: 'stripe-live', secretKey: stripeKey }, { secretKey: '' }, { webhookSecret: '' }, { secretKey: 'sk_live_fixture_only' },
    { publicOrigin: 'http://pets.example' },
  ]) {
    assert.throws(() => createMemorialApi({ dataDir, inviteCode: 'test-invite', payment: { ...base, ...invalid } }),
      undefined, 'Expected startup refusal for invalid field ' + Object.keys(invalid)[0]);
  }
});

test('Stripe 基础邀请码跨浏览器仅能产生一份权益，sandbox 邀请可用于多个测试主人', async (t) => {
  const provider = testProvider(), site = await setup(t, provider.fetchPayment);
  const a = site.browser(), b = site.browser();
  const order = await orderFor(a);
  ok(await b('/api/session'));
  const sameInvite = { product: 'foundation', requestId: randomUUID(), inviteCode: 'test-invite' };
  assert.ok((await b('/api/orders', sameInvite)).status >= 400);
  ok(await a('/api/orders/' + order.id + '/pay', {}));
  assert.equal(await deliver(site, notification(order, provider.calls[0].session)), 200);
  assert.ok(ok(await a('/api/orders/' + order.id + '/pay', {})).recoveryKey);
  assert.ok((await b('/api/orders', sameInvite)).status >= 400);
  assert.equal((await b('/api/orders/' + order.id + '/pay', {})).status, 404);
  assert.equal(ok(await b('/api/session')).owner, false);
  const sandbox = await setup(t, provider.fetchPayment, 'sandbox');
  for (const testBrowser of [sandbox.browser(), sandbox.browser()]) {
    const local = await orderFor(testBrowser);
    assert.ok(ok(await testBrowser('/api/orders/' + local.id + '/pay', {})).recoveryKey);
  }
  assert.equal(provider.calls.length, 1);
});

test('礼物付款通知在园主停止收礼后转人工复核，回调重试不放置礼物', async (t) => {
  const provider = testProvider(), site = await setup(t, provider.fetchPayment);
  const owner = site.browser(), visitor = site.browser(), base = await orderFor(owner);
  const basePay = '/api/orders/' + base.id + '/pay';
  ok(await owner(basePay, {}));
  assert.equal(await deliver(site, notification(base, provider.calls[0].session)), 200);
  ok(await owner(basePay, {}));
  const { garden } = ok(await owner('/api/gardens', {
    name: '麦芽', place: 'stone', story: '', photo: 'data:image/webp;base64,' + samplePhoto.toString('base64'),
  }));
  const path = '/api/gardens/' + garden.id;
  ok(await owner(path, { isPublic: true }, 'PATCH'));
  ok(await visitor('/api/session'));
  const gift = ok(await visitor('/api/orders', { product: 'vase', gardenId: garden.id, requestId: randomUUID() })).order;
  const giftPath = '/api/orders/' + gift.id;
  ok(await visitor(giftPath + '/pay', {}));
  ok(await owner(path, { acceptsFlowers: false }, 'PATCH'));
  const receipt = notification(gift, provider.calls[1].session);
  assert.equal(await deliver(site, receipt), 200);
  assert.equal(ok(await visitor(giftPath)).order.status, 'needs_review');
  assert.equal(await deliver(site, receipt), 200);
  assert.deepEqual(ok(await owner(path)).garden.gifts, []);
});

test('同一园主从两台设备同时开始庭院结算时仅开放一处；过期后可换设备继续', async (t) => {
  const provider = testProvider(), site = await setup(t, provider.fetchPayment);
  const devices = [site.browser(), site.browser()];
  const base = await orderFor(devices[0]), activate = '/api/orders/' + base.id + '/pay';
  ok(await devices[0](activate, {}));
  assert.equal(await deliver(site, notification(base, provider.calls[0].session)), 200);
  const { recoveryKey } = ok(await devices[0](activate, {}));
  ok(await devices[1]('/api/session'));
  assert.ok(ok(await devices[1]('/api/restore', { key: recoveryKey })).owner);

  const orders = await Promise.all(devices.map(async (client) => {
    return ok(await client('/api/orders', { product: 'courtyard', requestId: randomUUID() })).order;
  }));
  const paths = orders.map(({ id }) => '/api/orders/' + id + '/pay');
  const attempts = await Promise.all(devices.map((client, index) => client(paths[index], {})));
  const first = attempts.findIndex(({ status }) => status === 200);
  assert.notEqual(first, -1);
  const next = 1 - first;
  assert.equal(attempts[next].status, 409);
  assert.equal(provider.calls.length, 2);
  const initial = provider.calls[1].session;
  assert.equal(attempts[first].body.checkoutUrl, initial.url);

  const expired = notification(orders[first], initial, { payment_status: 'unpaid', status: 'expired' });
  expired.type = 'checkout.session.expired';
  assert.equal(await deliver(site, expired), 200);
  const moved = ok(await devices[next](paths[next], {}));
  assert.equal(provider.calls.length, 3);
  assert.equal(moved.checkoutUrl, provider.calls[2].session.url);
  assert.notEqual(moved.checkoutUrl, initial.url);
  assert.equal(await deliver(site, expired), 200);
  assert.equal(await deliver(site, notification(orders[first], initial)), 409);
  assert.equal((await devices[first](paths[first], {})).status, 409);

  assert.equal(await deliver(site, notification(orders[next], provider.calls[2].session)), 200);
  const yard = ok(await devices[next]('/api/courtyard')).courtyard;
  assert.ok(yard.id);
  assert.equal(ok(await devices[first]('/api/courtyard')).courtyard.id, yard.id);
  assert.equal(provider.calls.length, 3);
});

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'server', 'issue-invites.mjs');

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pets-invites-test-'));
  const dataDir = join(dir, 'data');
  t.after(() => rm(dir, { recursive: true, force: true }));
  function issue(output, count = 3, mode = 'stripe-test') {
    const result = spawnSync(process.execPath, [cli, '--mode', mode, '--count', String(count), '--output', output], {
      env: { PETS_DATA_DIR: dataDir }, cwd: root, encoding: 'utf8',
    });
    if (result.error) throw result.error;
    return { code: result.status, log: result.stdout + result.stderr };
  }
  async function codes(count = 3, mode = 'stripe-test') {
    const output = join(dir, 'invites-' + crypto.randomUUID() + '.txt');
    const result = issue(output, count, mode);
    assert.equal(result.code, 0, 'Invite generation failed');
    const contents = await readFile(output, 'utf8');
    const tokens = contents.trimEnd().split('\n');
    assert.equal(tokens.length, count);
    assert.equal(new Set(tokens).size, count);
    assert.ok(tokens.every((token) => /^[A-Za-z0-9_-]{22,}$/.test(token)), 'Expected strong URL-safe tokens');
    assert.ok(tokens.every((token) => !result.log.includes(token)), 'Output must omit secret values');
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    return { output, tokens };
  }
  return { dir, dataDir, issue, codes };
}

// Compare cardinalities across all persisted tables. No invite values are logged on failure.
function counts(dataDir) {
  const db = new DatabaseSync(join(dataDir, 'memorials.sqlite'), { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    return Object.fromEntries(tables.map(({ name }) => {
      const ident = '"' + name.replaceAll('"', '""') + '"';
      return [name, db.prepare('SELECT count(*) AS n FROM ' + ident).get().n];
    }));
  } finally {
    db.close();
  }
}

async function noPlaintext(dataDir, tokens) {
  const files = (await readdir(dataDir)).filter((name) => name.startsWith('memorials.sqlite'));
  assert.ok(files.length > 0);
  for (const name of files) {
    const bytes = await readFile(join(dataDir, name));
    assert.ok(tokens.every((token) => !bytes.includes(token)), 'Issued token appeared in SQLite storage');
  }
}

async function serve(t, dataDir, mode = 'stripe-test', legacyCode) {
  // Exercise the runtime environment-variable path in a clean child, with all provider I/O disabled.
  const program = `
    import { createServer } from 'node:http';
    import { attachMemorialApi } from './server/runtime.mjs';
    globalThis.fetch = () => { throw new Error('Provider I/O is disabled in invitation tests'); };
    const api = attachMemorialApi(process.cwd());
    const server = createServer((req, res) => api(req, res, () => res.writeHead(404).end()));
    server.listen(0, '127.0.0.1', () => process.send(server.address().port));
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', program], {
    cwd: root,
    env: {
      PETS_DATA_DIR: dataDir, PETS_PAYMENT_MODE: mode, PETS_PUBLIC_ORIGIN: 'https://pets.example',
      PETS_STRIPE_SECRET_KEY: mode === 'stripe-live' ? 'sk_live_fixture_only' : 'sk_test_fixture_only',
      PETS_STRIPE_WEBHOOK_SECRET: 'whsec_fixture_only',
      ...(legacyCode === undefined ? {} : { PETS_INVITE_CODE: legacyCode }),
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  async function close() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, 'exit');
    child.kill();
    await ended;
  }
  t.after(close);
  const port = await new Promise((resolve, reject) => {
    const died = () => reject(new Error('API failed to start: ' + stderr));
    child.once('exit', died);
    child.once('error', reject);
    child.once('message', (port) => { child.off('exit', died); resolve(port); });
  });
  const local = 'http://127.0.0.1:' + port;
  async function buyer() {
    const opened = await fetch(local + '/api/session');
    assert.equal(opened.status, 200);
    const cookies = opened.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
    return async (token, id = crypto.randomUUID()) => {
      const response = await fetch(local + '/api/orders', {
        method: 'POST', headers: { origin: local, cookie: cookies, 'content-type': 'application/json' },
        body: JSON.stringify({ product: 'foundation', requestId: id, inviteCode: token }),
      });
      return { status: response.status, body: await response.json() };
    };
  }
  return { buyer, close };
}

test('发行 CLI 创建仅持有者可读写的交付文件；目标已存在、为链接或参数错误时不新增邀请码', async (t) => {
  const store = await fixture(t);
  const { output, tokens } = await store.codes(3);
  const before = counts(store.dataDir);
  await noPlaintext(store.dataDir, tokens);
  assert.ok(store.issue(output).code !== 0);
  const sentinel = join(store.dir, 'existing.txt'), link = join(store.dir, 'target-link');
  await writeFile(sentinel, 'preserve this file');
  await symlink(sentinel, link);
  assert.ok(store.issue(link).code !== 0);
  assert.equal(await readFile(sentinel, 'utf8'), 'preserve this file');
  const dangling = join(store.dir, 'dangling');
  const missing = join(store.dir, 'no-file');
  await symlink(missing, dangling);
  assert.ok(store.issue(dangling).code !== 0);
  await assert.rejects(stat(missing), { code: 'ENOENT' });
  const invalid = join(store.dir, 'invalid.txt');
  assert.ok(store.issue(invalid, 0).code !== 0);
  assert.ok(store.issue(invalid, 2, 'invalid-mode').code !== 0);
  await assert.rejects(stat(invalid), { code: 'ENOENT' });
  assert.deepEqual(counts(store.dataDir), before);
  assert.ok((await readFile(output, 'utf8')).trimEnd().split('\n').every((token, i) => token === tokens[i]));
});

test('服务无静态码启动后可连续在线发码；不同受邀者同时开单，同码抢占和重试不重复开单', async (t) => {
  const store = await fixture(t);
  const site = await serve(t, store.dataDir);
  const { tokens } = await store.codes(3);
  const [a, b, c, d] = await Promise.all(Array.from({ length: 4 }, () => site.buyer()));
  const request = crypto.randomUUID();
  const [initial, again, another] = await Promise.all([a(tokens[0], request), a(tokens[0], request), b(tokens[1])]);
  assert.ok([200, 201].includes(initial.status) && [200, 201].includes(again.status));
  assert.equal(initial.body.order.id, again.body.order.id);
  assert.equal(another.status, 201);
  assert.notEqual(initial.body.order.id, another.body.order.id);
  const conflicts = await Promise.all([c(tokens[2]), d(tokens[2])]);
  assert.deepEqual(conflicts.map(({ status }) => status).sort(), [201, 409]);
  // The same already-running server must see a subsequent issuance immediately.
  const nextBatch = await store.codes(2);
  const newcomers = await Promise.all([site.buyer(), site.buyer()]);
  const nextOrders = await Promise.all(newcomers.map((client, i) => client(nextBatch.tokens[i])));
  assert.deepEqual(nextOrders.map(({ status }) => status), [201, 201]);
  assert.notEqual(nextOrders[0].body.order.id, nextOrders[1].body.order.id);
  assert.equal(new Set([...tokens, ...nextBatch.tokens]).size, 5);
  await noPlaintext(store.dataDir, [...tokens, ...nextBatch.tokens]);
  await site.close();
});

test('发行码仅适用于所属支付模式；旧单一邀请码继续可用且不能跨买家重用', async (t) => {
  const store = await fixture(t);
  const { tokens: [testOnly] } = await store.codes(1, 'stripe-test');
  const legacy = 'old-style-foundation-invite';
  const live = await serve(t, store.dataDir, 'stripe-live');
  assert.equal((await (await live.buyer())(testOnly)).status, 401);
  await live.close();
  const testMode = await serve(t, store.dataDir, 'stripe-test', legacy);
  const issued = await testMode.buyer(), original = await testMode.buyer(), stranger = await testMode.buyer();
  assert.equal((await issued(testOnly)).status, 201);
  assert.equal((await original(legacy)).status, 201);
  assert.equal((await stranger(legacy)).status, 409);
  await noPlaintext(store.dataDir, [legacy, testOnly]);
  await testMode.close();
});

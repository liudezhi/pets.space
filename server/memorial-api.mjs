import { products } from '../shared/catalogue.mjs';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createCommerce } from './commerce.mjs';
import { createPaymentProvider } from './stripe-checkout.mjs';
import { initializeInvites, hasInvite } from './invite-store.mjs';
import { createLegacyCare, originalOf } from './legacy-care.mjs';

const COOKIE = 'qiguang_session';
const BUYER_COOKIE = 'qiguang_buyer';
const SESSION_TTL = 60 * 60 * 24 * 90;
const MAX_PHOTO = 1536 * 1024;
const PHOTO_PREFIX = 'data:image/webp;base64,';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function reject(status, message) {
  throw new ApiError(status, message);
}

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function assertSameOrigin(req) {
  // Fetch Metadata protects browsers even when they suppress the Origin header.
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') reject(403, '请在花园页面内提交。');
  const origin = req.headers.origin;
  if (!origin) return; // Non-browser clients still need JSON and the appropriate credential.
  let parsed;
  try { parsed = new URL(origin); } catch { reject(403, '访问来源无效。'); }
  const protocol = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:';
  if (parsed.origin !== origin || parsed.host !== req.headers.host || parsed.protocol !== protocol) {
    reject(403, '请在同一个花园网站内提交。');
  }
}

function readBytes(req, limit) {
  if (Number(req.headers['content-length']) > limit) reject(413, '提交的内容太大。');
  return new Promise((resolve, fail) => {
    let size = 0;
    const chunks = [];
    let overLimit = false;
    req.on('data', chunk => {
      if (overLimit) return;
      size += chunk.length;
      if (size > limit) {
        overLimit = true;
        chunks.length = 0;
        fail(new ApiError(413, '提交的内容太大。'));
      } else {
        chunks.push(chunk);
      }
    });
    req.once('error', () => fail(new ApiError(400, '请求读取失败。')));
    req.once('aborted', () => fail(new ApiError(400, '请求已中断。')));
    req.once('end', () => {
      if (overLimit) return;
      resolve(Buffer.concat(chunks, size));
    });
  });
}

async function readJson(req, limit) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    reject(415, '请使用 JSON 格式提交。');
  }
  const bytes = await readBytes(req, limit);
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    reject(400, '提交的 JSON 格式有误。');
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest();
}

function token() {
  return randomBytes(32).toString('base64url');
}

function validateText(value, maximum, required) {
  if (typeof value !== 'string') reject(400, '名字和回忆需要用文字填写。');
  const text = value.trim();
  if ((required && !text) || Array.from(text).length > maximum || text.includes('\0')) {
    reject(400, '名字需为 1 至 40 字，回忆最多 2000 字。');
  }
  return text;
}

// Keep only the still image and its alpha channel; public visitors never receive
// camera EXIF, XMP, or other optional metadata from an uploaded container.
function webpData(value) {
  const invalid = () => reject(400, '请上传有效的静态 WebP 照片，长边最多 4096 像素。');
  if (typeof value !== 'string' || !value.startsWith(PHOTO_PREFIX)) invalid();
  const encoded = value.slice(PHOTO_PREFIX.length);
  if (encoded.length > Math.ceil(MAX_PHOTO / 3) * 4) reject(413, '照片最大为 1.5 MiB。');
  const image = Buffer.from(encoded, 'base64');
  if (image.length > MAX_PHOTO) reject(413, '照片最大为 1.5 MiB。');
  if (image.toString('base64') !== encoded || image.length < 26 ||
      image.toString('latin1', 0, 4) !== 'RIFF' || image.toString('latin1', 8, 12) !== 'WEBP' ||
      image.readUInt32LE(4) !== image.length - 8) invalid();

  let frame, alpha, ext, width, height;
  for (let p = 12; p < image.length;) {
    if (p + 8 > image.length) invalid();
    const type = image.toString('latin1', p, p + 4);
    const length = image.readUInt32LE(p + 4);
    const start = p + 8, end = start + length, aligned = end + length % 2;
    if (aligned > image.length) invalid();
    const chunk = image.subarray(p, aligned);
    if (type === 'VP8X') {
      if (ext || length !== 10 || (image[start] & 2)) invalid();
      ext = chunk;
    } else if (type === 'ALPH') {
      if (alpha || !length || frame) invalid();
      alpha = chunk;
    } else if (type === 'ANIM' || type === 'ANMF') {
      invalid();
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (frame) invalid();
      frame = chunk;
      if (type === 'VP8 ') {
        if (length <= 10 || (image[start] & 1) || image.readUIntLE(start + 3, 3) !== 0x2a019d) invalid();
        width = image.readUInt16LE(start + 6) & 0x3fff;
        height = image.readUInt16LE(start + 8) & 0x3fff;
      } else {
        if (length <= 5 || image[start] !== 0x2f || alpha) invalid();
        const bits = image.readUInt32LE(start + 1);
        if (bits >>> 29) invalid();
        width = 1 + (bits & 0x3fff);
        height = 1 + ((bits >>> 14) & 0x3fff);
      }
    }
    p = aligned;
  }
  if (!frame || !width || !height || Math.max(width, height) > 4096) invalid();
  const parts = [image.subarray(0, 12)];
  if (alpha) {
    if (!ext || ext.readUIntLE(12, 3) !== width - 1 || ext.readUIntLE(15, 3) !== height - 1) invalid();
    const clean = Buffer.from(ext);
    clean.writeUInt32LE(16, 8); // VP8X alpha flag, no metadata flags.
    parts.push(clean, alpha);
  }
  parts.push(frame);
  const output = Buffer.concat(parts);
  output.writeUInt32LE(output.length - 8, 4);
  return output;
}

function quotaTracker() {
  const counters = new Map();
  let sweepAt = 0;
  return (address, group, maximum, period) => {
    const now = Date.now();
    if (now >= sweepAt) {
      for (const [key, counter] of counters) if (counter.end <= now) counters.delete(key);
      sweepAt = now + 60_000;
    }
    const key = group + '/' + address;
    let counter = counters.get(key);
    if (!counter || counter.end <= now) {
      counter = { count: 0, end: now + period };
      counters.set(key, counter);
    }
    if (++counter.count > maximum) reject(429, '操作过于频繁，请稍后重试。');
  };
}

export function createMemorialApi({ dataDir, inviteCode, samplePhoto, payment }) {
  const provider = createPaymentProvider(payment, reject);
  if (typeof dataDir !== 'string' || !dataDir) throw new Error('纪念档案需要专用的数据目录。');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const databasePath = join(dataDir, 'memorials.sqlite');
  const db = new DatabaseSync(databasePath);
  chmodSync(databasePath, 0o600);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS owners (
      id TEXT PRIMARY KEY, recovery_hash BLOB NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS sessions (
      hash BLOB PRIMARY KEY, owner TEXT NOT NULL REFERENCES owners(id), expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_expiration ON sessions(expires);
    CREATE TABLE IF NOT EXISTS gardens (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES owners(id),
      name TEXT NOT NULL, story TEXT NOT NULL, place TEXT NOT NULL, photo BLOB NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0, accepts_flowers INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS garden_owner ON gardens(owner);
    CREATE INDEX IF NOT EXISTS garden_visibility ON gardens(is_public);
    CREATE TABLE IF NOT EXISTS flowers (
      garden TEXT NOT NULL REFERENCES gardens(id), request TEXT NOT NULL,
      PRIMARY KEY(garden, request)
    );
  `);
  const statements = new Map();
  function sql(query) {
    if (!statements.has(query)) statements.set(query, db.prepare(query));
    return statements.get(query);
  }
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  // Upgrade in place while holding a write lock so two starting processes
  // cannot race to add the column to an existing database.
  try {
    transaction(() => {
      const columns = db.prepare('PRAGMA table_info(gardens)').all();
      if (!columns.some(column => column.name === 'client_request_id')) {
        db.exec('ALTER TABLE gardens ADD COLUMN client_request_id TEXT');
      }
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS garden_create_request
        ON gardens(owner,client_request_id) WHERE client_request_id IS NOT NULL`);
      if (samplePhoto != null && !sql('SELECT id FROM gardens WHERE id=?').get('demo-riverbend')) {
        if (!Buffer.isBuffer(samplePhoto)) throw new Error('示例照片需要使用 WebP 缓冲区。');
        const image = webpData(PHOTO_PREFIX + samplePhoto.toString('base64'));
        // An empty BLOB can never equal the 32-byte digest of a recovery key.
        sql("INSERT OR IGNORE INTO owners(id,recovery_hash) VALUES ('system:sample',X'')").run();
        sql(`INSERT INTO gardens(id,owner,name,story,place,photo,is_public,accepts_flowers)
          VALUES ('demo-riverbend','system:sample','麦子',?,'stone',?,1,1)`)
          .run('从前沿河散步，你总会在水边停下来，等我跟上。今天也陪你在这里坐一会儿。', image);
      }
    });
  } catch (error) {
    db.close();
    throw error;
  }

  initializeInvites(db);
  const commerce = createCommerce({ db, sql, transaction, reject });
  const fields = `SELECT id,owner,name,story,place,is_public,accepts_flowers,
    (SELECT count(*) FROM flowers WHERE garden=gardens.id) AS flower_count FROM gardens`;
  function present(row, owner) {
    return {
      id: row.id, name: row.name, story: row.story, place: row.place,
      isPublic: Boolean(row.is_public), acceptsFlowers: Boolean(row.accepts_flowers),
      gifts: commerce.gifts(row.id), courtyard: commerce.gardenCourtyard(row.id),
      flowerCount: row.flower_count, isOwner: row.owner === owner, photoUrl: '/api/gardens/' + row.id + '/photo',
    };
  }
  function findGarden(id, owner, ownerOnly = false) {
    const row = sql(fields + ' WHERE id = ?').get(id);
    if (!row || (row.owner !== owner && (ownerOnly || !row.is_public))) reject(404, '未找到这处纪念档案。');
    return row;
  }

  const limit = quotaTracker();
  const invitation = typeof inviteCode === 'string' && inviteCode.trim() ? digest(inviteCode) : null;
  function readCookie(req, name) {
    const pair = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(name + '='));
    const value = pair?.slice(name.length + 1);
    return value && /^[\w-]{43}$/.test(value) ? value : null;
  }
  function writeCookie(req, res, name, value) {
    const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
    const cookie = name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + SESSION_TTL + (secure ? '; Secure' : '');
    res.appendHeader('Set-Cookie', cookie);
  }
  function ownerOf(req) {
    const raw = readCookie(req, COOKIE);
    if (!raw) return null;
    return sql('SELECT owner FROM sessions WHERE hash=? AND expires>?').get(digest(raw), Date.now())?.owner ?? null;
  }
  function requireOwner(owner) {
    if (!owner) reject(401, '请先使用邀请码或恢复钥匙进入。');
  }

  function issueSession(req, res, owner) {
    const value = token();
    const now = Date.now();
    sql('DELETE FROM sessions WHERE expires <= ?').run(now);
    sql('INSERT INTO sessions VALUES (?,?,?)').run(digest(value), owner, now + SESSION_TTL * 1000);
    writeCookie(req, res, COOKIE, value);
  }

  const care = createLegacyCare({ db, sql, transaction, reject, readJson, json, requireOwner, findGarden, present, webpData, limit, allGifts: commerce.allGifts });
  async function middleware(req, res, next) {
    const path = (req.url ?? '/').split('?')[0];
    if (!path.startsWith('/api/') && path !== '/api') return next();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      const method = req.method;
      const ip = req.socket.remoteAddress ?? 'local';
      if (path === '/api/payments/stripe/webhook') {
        if (provider.mode === 'sandbox') reject(404, '未找到这个地址。');
        if (method !== 'POST') reject(405, '支付通知只接受 POST。');
        if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') reject(415, '通知应为 JSON。');
        if (!req.headers['stripe-signature']) reject(400, '支付通知缺少签名。');
        const bytes = await readBytes(req, 256 * 1024);
        provider.webhook(bytes, req.headers['stripe-signature'], commerce);
        return json(res, 200, { received: true });
      }
      const writing = !['GET', 'HEAD', 'OPTIONS'].includes(method);
      if (writing) {
        assertSameOrigin(req);
        limit(ip, 'writes', 180, 60_000);
      }
      const owner = ownerOf(req);
      const buyer = readCookie(req, BUYER_COOKIE);
      if (path === '/api/sign-out' && method === 'POST') {
        await readJson(req, 1024);
        const session = readCookie(req, COOKIE);
        if (session) sql('DELETE FROM sessions WHERE hash=?').run(digest(session));
        for (const name of [COOKIE, BUYER_COOKIE]) res.appendHeader('Set-Cookie', name + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
        return json(res,200,{ok:true});
      }
      if (path === '/api/session' && method === 'GET') {
        if (!buyer) writeCookie(req, res, BUYER_COOKIE, token());
        const session = { owner: Boolean(owner) };
        if (provider.mode !== 'sandbox') session.paymentMode = provider.mode;
        return json(res, 200, session);
      }
      if (path === '/api/session' && method === 'POST') {
        reject(410, '请用邀请码创建基础建园订单，并完成结算。');
      }
      if (path === '/api/orders' || path.startsWith('/api/orders/')) {
        if (!buyer) {
          if (path === '/api/orders' && method === 'POST') reject(409, '请先打开花园以建立购买会话。');
          if (path === '/api/orders' && method === 'GET') return json(res, 200, { orders: [] });
          reject(404, '未找到这张订单。');
        }
        const buyerHash = digest(buyer).toString('hex');
        if (path === '/api/orders' && method === 'GET') return json(res, 200, { orders: commerce.orders(buyerHash) });
        if (path === '/api/orders' && method === 'POST') {
          limit(ip, 'order', 40, 60_000);
          const input = await readJson(req, 4096);
          if (typeof input.product !== 'string' || !Object.hasOwn(products, input.product)) reject(400, '请选择有效的商品。');
          if (typeof input.requestId !== 'string' || !/^[\w-]{8,128}$/.test(input.requestId)) reject(400, '购买请求编号无效。');
          let inviteHash = null;
          if (input.product === 'foundation') {
            limit(ip, 'join', 24, 300_000);
            if (typeof input.inviteCode !== 'string' || !input.inviteCode) reject(401, '邀请码无效。');
            const submitted = digest(input.inviteCode);
            inviteHash = submitted.toString('hex');
            const legacy = invitation !== null && timingSafeEqual(submitted, invitation);
            if (!legacy && !hasInvite(db, provider.mode, inviteHash)) reject(401, '邀请码无效。');
          }
          const gift = input.product === 'lily' || input.product === 'vase';
          if (gift && (typeof input.gardenId !== 'string' || !/^[a-z0-9-]{1,64}$/.test(input.gardenId))) {
            reject(400, '请选择有效的纪念园。');
          }
          if (!gift && input.gardenId != null) reject(400, '这个商品不需要选择纪念园。');
          const result = commerce.create({
            buyerHash, owner, product: input.product, gardenId: input.gardenId ?? null, requestId: input.requestId,
            mode: provider.mode, inviteHash,
          });
          return json(res, result.created ? 201 : 200, { order: result.order });
        }
        const match = /^\/api\/orders\/([a-z0-9-]{1,64})(\/pay)?$/.exec(path);
        if (!match) reject(404, '未找到这张订单。');
        const [, id, pay] = match;
        if (!pay && method === 'GET') return json(res, 200, { order: commerce.order(id, buyerHash) });
        if (pay && method === 'POST') {
          await readJson(req, 2048);
          // Can safely reissue after a lost response without storing a plaintext key.
          const key = createHmac('sha256', buyer).update('garden-foundation/v1/' + id).digest('base64url');
          const options = { id, buyerHash, owner, recoveryHash: digest(key), mode: provider.mode };
          if (provider.mode !== 'sandbox') {
            const prepared = commerce.prepareCheckout(options);
            if (prepared.order.status === 'pending') {
              const checkoutUrl = await provider.checkout(commerce, prepared);
              return json(res, 200, { order: prepared.order, checkoutUrl, owner: Boolean(owner) });
            }
            if (prepared.order.status === 'needs_review') return json(res, 200, { order: prepared.order, owner: Boolean(owner) });
          }
          const result = commerce.pay(options);
          const response = { order: result.order, owner: Boolean(owner) };
          if (result.order.product === 'foundation') {
            if (result.canRecover && (!owner || owner === result.ownerId)) {
              if (!owner) issueSession(req, res, result.ownerId);
              response.owner = true;
              response.recoveryKey = key;
            }
          } else if (result.order.product === 'courtyard') {
            requireOwner(owner);
            response.courtyard = commerce.myCourtyard(owner);
          } else if (result.order.gardenId) {
            // Do not expose garden data on a payment replay after privacy was changed.
            const visible = sql(fields + ' WHERE id=? AND (is_public=1 OR owner=?)').get(result.order.gardenId, owner);
            if (visible) response.garden = present(visible, owner);
          }
          return json(res, 200, response);
        }
        reject(405, '此地址不支持这个操作。');
      }

      if (path === '/api/restore' && method === 'POST') {
        limit(ip, 'restore', 24, 300_000);
        const { key } = await readJson(req, 2048);
        if (typeof key !== 'string' || !/^[\w-]{43}$/.test(key)) reject(401, '恢复钥匙无效或已使用。');
        const replacement = token();
        transaction(() => {
          const row = sql('UPDATE owners SET recovery_hash=? WHERE recovery_hash=? RETURNING id').get(digest(replacement), digest(key));
          if (!row) reject(401, '恢复钥匙无效或已使用。');
          // A different person restoring on a shared browser gets a fresh checkout history.
          if (!buyer || (owner && owner !== row.id)) writeCookie(req, res, BUYER_COOKIE, token());
          issueSession(req, res, row.id);
        });
        return json(res, 200, { owner: true, recoveryKey: replacement });
      }

      if (path === '/api/courtyard' && method === 'GET') {
        requireOwner(owner);
        return json(res, 200, { courtyard: commerce.myCourtyard(owner) });
      }
      const court = /^\/api\/courtyards\/([a-z0-9-]{1,64})$/.exec(path);
      if (court && method === 'GET') {
        const { courtyard, gardenIds } = commerce.visibleCourtyard(court[1], owner);
        return json(res, 200, { courtyard, gardens: gardenIds.map(id => present(findGarden(id, owner), owner)) });
      }
      if (await care({ req, res, path, method, owner, ip })) return;

      if (path === '/api/mine' && method === 'GET') {
        requireOwner(owner);
        const rows = sql(fields + ' WHERE owner=? ORDER BY rowid DESC').all(owner);
        return json(res, 200, { gardens: rows.map(row => present(row, owner)) });
      }
      if (path === '/api/public' && method === 'GET') {
        const rows = sql(fields + ' WHERE is_public=1 ORDER BY rowid DESC').all();
        return json(res, 200, { gardens: rows.map(row => present(row, owner)) });
      }
      if (path === '/api/gardens' && method === 'POST') {
        requireOwner(owner);
        limit(owner, 'create', 16, 60_000);
        const input = await readJson(req, 15 * 1024 * 1024);
        const name = validateText(input.name, 40, true);
        const story = validateText(input.story ?? '', 2000, false);
        if (input.place !== 'stone' && input.place !== 'entrance') reject(400, '请从河湾与入口桦坡中选择一处。');
        const requestId = input.clientRequestId;
        if (requestId !== undefined && (typeof requestId !== 'string' || !/^[\w-]{8,128}$/.test(requestId))) {
          reject(400, '建园请求编号无效。');
        }
        const image = webpData(input.photo);
        const original = input.originalFile ? originalOf(input.originalFile, reject) : null;
        const result = transaction(() => {
          const id = randomUUID();
          const insert = sql(`INSERT INTO gardens(id,owner,name,story,place,photo,client_request_id)
            VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner,client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING`)
            .run(id, owner, name, story, input.place, image, requestId ?? null);
          if (insert.changes) {
            if (original) sql('INSERT INTO archive_photos VALUES(?,?,?,?,?,?,0,?)')
              .run(randomUUID(), id, digest(original).toString('hex'), input.originalFile.mime, original, image, new Date().toISOString());
            return { status: 201, id };
          }
          const previous = sql(`SELECT id, (name=? AND story=? AND place=? AND photo=?) AS matches
            FROM gardens WHERE owner=? AND client_request_id=?`).get(name, story, input.place, image, owner, requestId);
          if (!previous?.matches) reject(409, '这个建园请求已使用，请重新确认内容。');
          return { status: 200, id: previous.id };
        });
        return json(res, result.status, { garden: present(findGarden(result.id, owner), owner) });
      }

      const route = /^\/api\/gardens\/([a-z0-9-]{1,64})(?:\/(photo|flowers))?$/.exec(path);
      if (!route) reject(404, '未找到这个地址。');
      const [, id, action] = route;
      if (!action && method === 'GET') return json(res, 200, { garden: present(findGarden(id, owner), owner) });
      if (action === 'photo' && method === 'GET') {
        const row = sql('SELECT photo FROM gardens WHERE id=? AND (is_public=1 OR owner=?)').get(id, owner);
        if (!row) reject(404, '未找到这处纪念档案。');
        res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': row.photo.length });
        return res.end(row.photo);
      }
      if (!action && method === 'PATCH') {
        findGarden(id, owner, true);
        const patch = await readJson(req, 2048);
        const keys = Object.keys(patch);
        if (!keys.length || keys.some(k => !['isPublic','acceptsFlowers','inCourtyard'].includes(k) || typeof patch[k] !== 'boolean')) {
          reject(400, '请提交有效的公开或献花设置。');
        }
        transaction(() => {
          findGarden(id, owner, true);
          if ('inCourtyard' in patch) commerce.setMember(id, owner, patch.inCourtyard);
          sql(`UPDATE gardens SET is_public=COALESCE(?,is_public), accepts_flowers=COALESCE(?,accepts_flowers) WHERE id=? AND owner=?`)
            .run('isPublic' in patch ? Number(patch.isPublic) : null, 'acceptsFlowers' in patch ? Number(patch.acceptsFlowers) : null, id, owner);
        });
        return json(res, 200, { garden: present(findGarden(id, owner), owner) });
      }
      if (action === 'flowers' && method === 'POST') {
        limit(ip, 'flowers', 40, 60_000);
        const { requestId } = await readJson(req, 2048);
        if (typeof requestId !== 'string' || !/^[\w-]{8,128}$/.test(requestId)) reject(400, '献花请求编号无效。');
        const row = transaction(() => {
          const garden = findGarden(id, owner);
          if (!garden.is_public || !garden.accepts_flowers) reject(403, '这处纪念园暂不接收鲜花。');
          sql('INSERT INTO flowers(garden,request) VALUES (?,?) ON CONFLICT(garden,request) DO NOTHING').run(id, requestId);
          return findGarden(id, owner);
        });
        return json(res, 200, { garden: present(row, owner) });
      }
      reject(405, '此地址不支持这个操作。');
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      res.removeHeader('Set-Cookie');
      const status = error instanceof ApiError ? error.status : 500;
      if (status === 413) res.setHeader('Connection', 'close');
      json(res, status, { error: status === 500 ? '纪念档案暂时无法读取或保存。' : error.message });
    }
  }
  middleware.close = () => db.close();
  return middleware;
}

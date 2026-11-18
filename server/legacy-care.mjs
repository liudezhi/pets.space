import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createNeighborhoods } from './neighborhoods.mjs';
import { buildAlbum } from './offline-album.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function originalOf(input, reject) {
  const bad = () => reject(400, '原件需为 JPEG、PNG 或 WebP 图片。');
  if (typeof input.original !== 'string') bad();
  const bytes = Buffer.from(input.original, 'base64');
  if (bytes.length > 8 * 1024 * 1024) reject(413, '每张原件最多 8 MiB。');
  if (bytes.length < 12 || bytes.toString('base64') !== input.original) bad();
  const valid =
    (input.mime === 'image/jpeg' && bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) ||
    (input.mime === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) ||
    (input.mime === 'image/webp' &&
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP');
  if (!valid) bad();
  return bytes;
}

export function createLegacyCare({
  db,
  sql,
  transaction,
  reject,
  readJson,
  json,
  requireOwner,
  findGarden,
  present,
  webpData,
  limit,
  allGifts,
}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS archive_photos(
      id TEXT PRIMARY KEY, garden TEXT NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
      digest TEXT NOT NULL, mime TEXT NOT NULL, original BLOB NOT NULL, preview BLOB NOT NULL,
      is_public INTEGER DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(garden,digest));
    CREATE TABLE IF NOT EXISTS wishes(
      id TEXT PRIMARY KEY, garden TEXT NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
      message TEXT NOT NULL, is_public INTEGER NOT NULL, created_at TEXT NOT NULL, request_id TEXT NOT NULL, UNIQUE(garden,request_id));
    CREATE TABLE IF NOT EXISTS handovers(
      garden TEXT PRIMARY KEY REFERENCES gardens(id) ON DELETE CASCADE, recipient TEXT NOT NULL REFERENCES owners(id),
      code_hash TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS flower_dates(
      garden TEXT NOT NULL REFERENCES gardens(id) ON DELETE CASCADE, request TEXT NOT NULL, placed_at TEXT NOT NULL, PRIMARY KEY(garden,request));
    CREATE TRIGGER IF NOT EXISTS remember_flower_date AFTER INSERT ON flowers BEGIN
      INSERT INTO flower_dates VALUES(NEW.garden,NEW.request,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
  `);
  const neighborhood = createNeighborhoods(db);
  function text(value, max, allowBlank = false) {
    if (
      typeof value !== 'string' ||
      value.includes('\0') ||
      (!allowBlank && !value.trim()) ||
      [...value].length > max
    )
      reject(400, '请检查填写的文字与字数。');
    return value.trim();
  }
  const photos = (id, own) =>
    sql(
      'SELECT id,is_public AS isPublic,created_at AS createdAt FROM archive_photos WHERE garden=? AND (? OR is_public=1) ORDER BY rowid',
    )
      .all(id, Number(own))
      .map((photo) => ({ ...photo, previewUrl: '/api/gardens/' + id + '/album/' + photo.id }));
  return async ({ req, res, path, method, owner }) => {
    const send = (value, status = 200) => {
      json(res, status, value);
      return true;
    };
    const now = () => new Date().toISOString();
    if (path === '/api/neighborhoods' && method === 'GET') {
      const raw = new URL(req.url, 'http://localhost').searchParams.get('page') ?? '0';
      if (!/^\d{1,9}$/.test(raw)) reject(400, '园区页码无效。');
      return send(neighborhood(Number(raw)));
    }
    if (path === '/api/care/identity' && method === 'GET') {
      requireOwner(owner);
      return send({ recipient: owner });
    }
    if (path === '/api/care/accept' && method === 'POST') {
      requireOwner(owner);
      const { code } = await readJson(req, 2048);
      const id = transaction(() => {
        const record = sql('SELECT garden FROM handovers WHERE recipient=? AND code_hash=? AND expires>?').get(
          owner,
          hash(text(code, 128)),
          Date.now(),
        );
        if (!record) reject(404, '交接码无效或已过期。');
        sql('UPDATE gardens SET owner=?,client_request_id=NULL,is_public=0 WHERE id=?').run(
          owner,
          record.garden,
        );
        sql('DELETE FROM handovers WHERE garden=?').run(record.garden);
        return record.garden;
      });
      return send({ id });
    }
    if (path === '/api/wishes' && method === 'GET')
      return send({
        wishes: sql(
          `SELECT w.message,w.created_at AS createdAt,g.name FROM wishes w JOIN gardens g ON g.id=w.garden WHERE g.is_public=1 AND w.is_public=1 ORDER BY w.rowid DESC LIMIT 30`,
        ).all(),
      });
    const route =
      /^\/api\/gardens\/([a-z0-9-]{1,64})\/(archive|album|wishes|handover|record)(?:\/([a-z0-9-]{1,64}))?$/.exec(
        path,
      );
    if (!route) return false;
    const [, id, part, item] = route;
    const row = findGarden(id, owner);
    const own = !!owner && row.owner === owner;
    if (part === 'album' && method === 'GET') {
      if (!item) return send({ photos: photos(id, own) });
      const image = sql(
        'SELECT preview FROM archive_photos WHERE garden=? AND id=? AND (? OR is_public=1)',
      ).get(id, item, Number(own));
      if (!image) reject(404, '未找到照片。');
      res.writeHead(200, { 'Content-Type': 'image/webp' });
      res.end(image.preview);
      return true;
    }
    if (part === 'archive' && method === 'GET' && !item) {
      if (!own && id !== 'demo-riverbend') reject(404, '未找到这份档案。');
      const detail = present(row, owner);
      const address = sql('SELECT number FROM plot_addresses WHERE garden=?').get(id);
      const plot = address
        ? { page: Math.floor((address.number - 1) / 6), slot: (address.number - 1) % 6 }
        : null;
      const archive = {
        version: 1,
        plot,
        exportedAt: now(),
        id,
        name: row.name,
        story: row.story,
        place: row.place,
        isPublic: !!row.is_public,
        acceptsFlowers: !!row.accepts_flowers,
        courtyard: detail.courtyard || null,
        gifts: allGifts(id),
        wishes: sql(
          'SELECT message,created_at AS createdAt,is_public AS isPublic FROM wishes WHERE garden=? ORDER BY rowid',
        ).all(id),
        flowers: sql(
          'SELECT d.placed_at AS placedAt FROM flowers f LEFT JOIN flower_dates d ON f.garden=d.garden AND f.request=d.request WHERE f.garden=? ORDER BY f.rowid',
        ).all(id),
      };
      const cover = sql('SELECT photo FROM gardens WHERE id=?').get(id).photo;
      const images = sql(
        'SELECT mime,digest,original,preview,created_at AS createdAt,is_public AS isPublic FROM archive_photos WHERE garden=? ORDER BY rowid',
      ).all(id);
      const html = buildAlbum(archive, cover, images);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': 'attachment; filename="garden-' + id + '.html"',
        'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      });
      res.end(html);
      return true;
    }
    if (!own) reject(404, '未找到这份档案。');
    // An owner can transfer an archive while another request is still uploading.
    async function input(limitBytes = 2048) {
      const value = await readJson(req, limitBytes);
      findGarden(id, owner, true);
      return value;
    }
    if (part === 'album' && !item && method === 'POST') {
      limit(owner, 'photo', 15, 60000);
      const value = await input(15 * 1024 * 1024);
      const bytes = originalOf(value, reject),
        digest = hash(bytes),
        preview = webpData(value.preview);
      transaction(() => {
        if (sql('SELECT id FROM archive_photos WHERE garden=? AND digest=?').get(id, digest)) return;
        if (sql('SELECT count(*) AS n FROM archive_photos WHERE garden=?').get(id).n >= 6)
          reject(409, '每座测试花园最多保存六张原件。');
        sql('INSERT INTO archive_photos VALUES(?,?,?,?,?,?,0,?)').run(
          randomUUID(),
          id,
          digest,
          value.mime,
          bytes,
          preview,
          now(),
        );
      });
      return send({ photos: photos(id, true) }, 201);
    }
    if (part === 'album' && item && ['POST', 'PATCH'].includes(method)) {
      const value = await input();
      if (method === 'POST' && value.remove === true)
        sql('DELETE FROM archive_photos WHERE garden=? AND id=?').run(id, item);
      else if (method === 'PATCH' && typeof value.isPublic === 'boolean')
        sql('UPDATE archive_photos SET is_public=? WHERE garden=? AND id=?').run(
          Number(value.isPublic),
          id,
          item,
        );
      else reject(400, '请确认照片操作。');
      return send({ photos: photos(id, true) });
    }
    if (part === 'wishes' && !item && ['GET', 'POST'].includes(method)) {
      if (method === 'POST') {
        const value = await input(4096);
        if (
          typeof value.requestId !== 'string' ||
          !/^[-\w]{8,128}$/.test(value.requestId) ||
          typeof value.isPublic !== 'boolean'
        )
          reject(400, '请检查寄语设置。');
        sql('INSERT INTO wishes VALUES(?,?,?,?,?,?) ON CONFLICT(garden,request_id) DO NOTHING').run(
          randomUUID(),
          id,
          text(value.message, 180),
          Number(value.isPublic),
          now(),
          value.requestId,
        );
      }
      return send({
        wishes: sql(
          'SELECT id,message,is_public AS isPublic,created_at AS createdAt FROM wishes WHERE garden=? ORDER BY rowid DESC',
        ).all(id),
      });
    }
    if (part === 'wishes' && item && method === 'POST') {
      if ((await input()).remove !== true) reject(400, '请确认移除寄语。');
      sql('DELETE FROM wishes WHERE garden=? AND id=?').run(id, item);
      return send({ ok: true });
    }
    if (part === 'handover' && !item && method === 'POST') {
      const value = await input();
      if (value.cancel === true) {
        sql('DELETE FROM handovers WHERE garden=?').run(id);
        return send({ ok: true });
      }
      const recipient = text(value.recipient, 64);
      if (
        recipient === owner ||
        !sql('SELECT id FROM owners WHERE id=? AND id<>?').get(recipient, 'system:sample')
      )
        reject(400, '请填写家人园主账号的接收编号。');
      const code = randomBytes(24).toString('base64url'),
        expires = Date.now() + 7 * 86400000;
      sql('INSERT OR REPLACE INTO handovers VALUES(?,?,?,?)').run(id, recipient, hash(code), expires);
      return send({ code, expires });
    }
    if (part === 'record' && !item && method === 'PATCH') {
      const value = await input(16384);
      sql('UPDATE gardens SET name=?,story=? WHERE id=? AND owner=?').run(
        text(value.name, 40),
        text(value.story, 2000, true),
        id,
        owner,
      );
      return send({ garden: present(findGarden(id, owner, true), owner) });
    }
    if (part === 'record' && !item && method === 'POST') {
      const value = await input();
      transaction(() => {
        if (value.confirmName !== findGarden(id, owner, true).name) reject(400, '请输入完整名字以确认删除。');
        sql('DELETE FROM flowers WHERE garden=?').run(id);
        sql('DELETE FROM gardens WHERE id=? AND owner=?').run(id, owner);
      });
      return send({ ok: true });
    }
    reject(405, '不支持此档案操作。');
  };
}

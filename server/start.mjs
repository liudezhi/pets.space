import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachMemorialApi } from './runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = await realpath(resolve(root, 'dist'));
await stat(resolve(dist, 'index.html'));
const api = attachMemorialApi(root);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = http.createServer(async (req, res) => {
  async function serveStatic() {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400).end(); return; }
    const file = await realpath(resolve(dist, '.' + (path === '/' ? '/index.html' : path)));
    if (!file.startsWith(dist + sep)) { res.writeHead(404).end(); return; }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Content-Length': info.size, 'X-Content-Type-Options':'nosniff' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
  try {
    if (/^\/api(?:\/|\?|$)/.test(req.url)) {
      await api(req, res, () => res.writeHead(404).end());
    } else {
      await serveStatic();
    }
  } catch (err) {
    if (res.headersSent) res.destroy();
    else res.writeHead(['ENOENT','ENOTDIR'].includes(err.code) ? 404 : 500).end();
  }
});
const host = process.env.HOST || '127.0.0.1';
server.once('close', () => api.close());
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
server.listen(Number(process.env.PORT || 4173), host, () => console.info('栖光谷已启动 http://' + host + ':' + server.address().port));

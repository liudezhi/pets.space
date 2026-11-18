import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

async function installApi(server) {
  const { attachMemorialApi } = await import('./server/runtime.mjs');
  const api = attachMemorialApi(root);
  server.middlewares.use(api);
  server.httpServer?.once('close', () => api.close());
}
export default defineConfig({
  server: { host: '127.0.0.1', allowedHosts: ['terminal.local'] },
  plugins: [{ name: 'memorial-api', configureServer: installApi, configurePreviewServer: installApi }]
});

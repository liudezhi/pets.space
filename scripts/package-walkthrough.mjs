import { build } from 'vite';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const destination = resolve(process.argv[2] || join(root, 'dist', '栖光谷-免安装游览.html'));
const result = await build({
  root, configFile: false, publicDir: false,
  build: {
    write: false, assetsInlineLimit: Infinity, cssCodeSplit: false, sourcemap: false,
    lib: { entry: join(root, 'scripts/walkthrough/entry.js'), name: 'QiguangWalkthrough', formats: ['iife'] },
  },
});
const output = (Array.isArray(result) ? result.flatMap(item => item.output) : result.output);
const chunks = output.filter(file => file.type === 'chunk');
const styles = output.filter(file => file.type === 'asset' && file.fileName.endsWith('.css'));
if (chunks.length !== 1 || !styles.length || output.length !== 1 + styles.length) {
  throw new Error('离线版本产生了额外外部文件，请检查打包配置。');
}
const template = await readFile(join(root, 'scripts/walkthrough/page.html'), 'utf8');
const html = template
  .replace('/* INLINE_STYLES */', () => styles.map(file => file.source).join('\n'))
  .replace('/* INLINE_SCENE */', () => chunks[0].code.replace(/<\/script/gi, '<\\/script'));
await mkdir(dirname(destination), { recursive:true });
const temp = destination + '.' + randomUUID() + '.tmp';
await writeFile(temp, html, { mode:0o644 });
await rename(temp, destination);
console.log('已生成离线漫游文件（' + (Buffer.byteLength(html)/1024/1024).toFixed(2) + ' MiB）');

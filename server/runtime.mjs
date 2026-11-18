import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createMemorialApi } from './memorial-api.mjs';

function outside(root, dir) {
  const rel = relative(root, dir);
  return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel);
}

export function attachMemorialApi(projectRoot) {
  const root = realpathSync(projectRoot);
  const dir = resolve(process.env.PETS_DATA_DIR || resolve(dirname(root), '.pets-space-data', basename(root)));
  if (!outside(root, dir)) throw new Error('请将 PETS_DATA_DIR 设置到项目目录之外。');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dataDir = realpathSync(dir);
  if (!outside(root, dataDir)) throw new Error('纪念档案不能保存在网站目录中。');
  const inviteCode = process.env.PETS_INVITE_CODE || randomBytes(12).toString('base64url');
  if (!process.env.PETS_INVITE_CODE) console.info('本次启动的测试建园邀请码：' + inviteCode);
  const portraitPath = [resolve(root, 'public/pet.webp'), resolve(root, 'dist/pet.webp')].find(existsSync);
  const samplePhoto = portraitPath ? readFileSync(portraitPath) : undefined;
  return createMemorialApi({ dataDir, inviteCode, samplePhoto });
}

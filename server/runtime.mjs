import { existsSync, linkSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createMemorialApi } from './memorial-api.mjs';

function outside(root, dir) {
  const rel = relative(root, dir);
  return rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel);
}

function loadSandboxInvite(dataDir) {
  const file = resolve(dataDir, 'sandbox-invite.txt');
  if (!existsSync(file)) {
    const temporary = file + '.' + randomBytes(8).toString('hex');
    writeFileSync(temporary, randomBytes(12).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 });
    try { linkSync(temporary, file); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    finally { unlinkSync(temporary); }
  }
  const invite = readFileSync(file, 'utf8').trim();
  if (!invite) throw new Error('本地沙盒邀请码文件为空。');
  console.info('沙盒建园邀请码存放于 ' + file);
  return invite;
}

export function memorialDataDirectory(projectRoot) {
  const root = realpathSync(projectRoot);
  const dir = resolve(process.env.PETS_DATA_DIR || resolve(dirname(root), '.pets-space-data', basename(root)));
  if (!outside(root, dir)) throw new Error('请将 PETS_DATA_DIR 设置到项目目录之外。');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dataDir = realpathSync(dir);
  if (!outside(root, dataDir)) throw new Error('纪念档案不能保存在网站目录中。');
  return dataDir;
}

export function attachMemorialApi(projectRoot) {
  const root = realpathSync(projectRoot);
  const dataDir = memorialDataDirectory(root);
  const payment = {
    mode: process.env.PETS_PAYMENT_MODE ?? 'sandbox',
    secretKey: process.env.PETS_STRIPE_SECRET_KEY,
    webhookSecret: process.env.PETS_STRIPE_WEBHOOK_SECRET,
    publicOrigin: process.env.PETS_PUBLIC_ORIGIN,
  };
  let inviteCode = process.env.PETS_INVITE_CODE;
  if (payment.mode === 'sandbox' && !inviteCode) {
    inviteCode = loadSandboxInvite(dataDir);
  }
  const portraitPath = [resolve(root, 'public/pet.webp'), resolve(root, 'dist/pet.webp')].find(existsSync);
  const samplePhoto = portraitPath ? readFileSync(portraitPath) : undefined;
  return createMemorialApi({ dataDir, inviteCode, samplePhoto, payment });
}

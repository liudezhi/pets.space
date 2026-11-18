import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { issueInvites } from './invite-store.mjs';
import { memorialDataDirectory } from './runtime.mjs';

const usage = `为托管收银台发放基础建园邀请码

node server/issue-invites.mjs --mode stripe-test|stripe-live --count 1..1000 --output 新文件路径

PETS_DATA_DIR 指向网站使用的数据目录；省略时使用网站默认目录。
输出父目录须已存在、归当前系统用户所有且仅限该用户访问。请使用站点目录外的私有路径。
每行一个单用邀请码。服务运行期间可多次发放，下一批须指定新的输出文件。
邀请码无自动到期日。首次下单后保留给该购买会话，已付款的码不能再次建园。`;

function argumentsForIssuer() {
  try {
    const { values } = parseArgs({ options: {
      mode: { type: 'string' }, count: { type: 'string' },
      output: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    } });
    if (values.help) return null;
    if (!['stripe-live', 'stripe-test'].includes(values.mode) ||
        !/^\d{1,4}$/.test(values.count ?? '') || Number(values.count) < 1 || Number(values.count) > 1000 || !values.output) {
      throw new Error();
    }
    return { mode: values.mode, count: Number(values.count), outputFile: resolve(values.output) };
  } catch {
    throw new Error('请指定有效的模式、数量和输出文件。使用 --help 查看用法。');
  }
}

function outside(directory, file) {
  const distance = relative(directory, file);
  return distance === '..' || distance.startsWith('..' + sep) || isAbsolute(distance);
}

function run() {
  const options = argumentsForIssuer();
  if (!options) return console.log(usage);
  const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
  let targetDirectory;
  try { targetDirectory = realpathSync(dirname(options.outputFile)); }
  catch { throw new Error('输出文件的父目录必须已经存在。'); }
  const canonicalOutput = join(targetDirectory, basename(options.outputFile));
  if (!outside(root, options.outputFile) || !outside(root, canonicalOutput)) {
    throw new Error('邀请码文件必须位于站点目录之外。');
  }
  const dataDir = memorialDataDirectory(root);
  if (process.env.PETS_DATA_DIR && resolve(process.env.PETS_DATA_DIR) !== dataDir) {
    throw new Error('发码数据目录不能经过符号链接。');
  }
  if (targetDirectory === dataDir && /^(?:memorials\.sqlite(?:-(?:wal|shm|journal))?|sandbox-invite\.txt)$/.test(basename(canonicalOutput))) {
    throw new Error('输出文件不能使用花园系统保留的文件名。');
  }
  const result = issueInvites({ dataDir, ...options });
  console.log('已发放 ' + result.count + ' 个 ' + result.mode + ' 邀请码，保存于 ' + result.outputFile);
}

try { run(); }
catch (error) {
  // Only emit operational messages, never tokens, secret values, or a SQL trace.
  console.error(error.code ? '未能安全写入邀请码，请检查私有目录、目标文件和数据库状态。' : error.message);
  process.exitCode = 1;
}

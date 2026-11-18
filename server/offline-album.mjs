import { readFileSync } from 'node:fs';

const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => entities[character]);
const bytes64 = (bytes) => Buffer.from(bytes).toString('base64');
const giftNames = { lily: '百合花束', vase: '纪念花瓶' };
const dateLabel = (value) =>
  value ? new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '早期记录，日期未保存';

// Keep this version's landmarks available when the live valley is remodelled.
const locations = {
  stone: { label: '南岸河湾', bearing: '西北', view: '河湾石边望向拱桥与上游' },
  entrance: { label: '西南桦坡', bearing: '东北', view: '从白桦下的草甸远望拱桥与许愿树' },
  courtyard: { label: '听风山庭', bearing: '西', view: '从东岸石墙内的长椅望向远山' },
};
const viewPhotos = new Map();
function landscape(id) {
  if (!viewPhotos.has(id)) {
    const bytes = readFileSync(new URL('./archive-views/' + id + '.webp', import.meta.url));
    viewPhotos.set(id, bytes64(bytes));
  }
  return viewPhotos.get(id);
}
function vista(id) {
  const { label, view, bearing } = locations[id];
  return `<figure><img alt="${view}" src="data:image/webp;base64,${landscape(id)}"><figcaption>${label} · 朝${bearing}。${view}。</figcaption></figure>`;
}
function picture(photo, index) {
  return `<figure><img alt="相册照片 ${index + 1}" src="data:image/webp;base64,${bytes64(photo.preview)}"><figcaption><a download="photo-${index + 1}.${photo.mime.split('/')[1]}" href="data:${photo.mime};base64,${bytes64(photo.original)}">保存第 ${index + 1} 张原图</a> · ${dateLabel(photo.createdAt)}</figcaption></figure>`;
}
export function buildAlbum(data, cover, photos) {
  const site = Object.hasOwn(locations, data.place) ? data.place : 'stone';
  const views = data.courtyard ? [site, 'courtyard'] : [site];
  const metadata = {
    ...data,
    sceneVersion: 'riverbend-1',
    views: views.map((id) => ({ id, ...locations[id] })),
    photos: photos.map(({ digest, mime, createdAt, isPublic }) => ({
      sha256: digest,
      mime,
      createdAt,
      isPublic: Boolean(isPublic),
    })),
  };
  const lines = [
    ...data.flowers.map((f) => dateLabel(f.placedAt) + ' · 雏菊'),
    ...data.gifts.map((g) => dateLabel(g.placedAt) + ' · ' + escape(giftNames[g.type] || g.type)),
    ...data.wishes.map((w) => dateLabel(w.createdAt) + ' · ' + escape(w.message)),
  ]
    .map((label) => '<li>' + label + '</li>')
    .join('');
  const download = bytes64(JSON.stringify(metadata, null, 2));
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>${escape(data.name)}的纪念册 · 栖光谷</title>
<style>
  body{max-width:740px;margin:4vh auto;padding:clamp(18px,4vw,40px);color:#294235;background:#f7f5ec;font:16px/1.85 system-ui,sans-serif}
  h1,h2{font-family:serif;font-weight:500;line-height:1.3}h1{font-size:clamp(2.4rem,7vw,4rem);margin:.2em 0}
  .portrait{display:block;max-width:100%;width:auto;max-height:55vh;margin:1.5em 0;border-radius:4px}
  p,li{white-space:pre-wrap;overflow-wrap:anywhere}figure{margin:18px 0}figure img{display:block;max-width:100%;max-height:420px;object-fit:contain}
  figcaption,small,footer{color:#526353}section,footer{border-top:1px solid #c7cebe;margin-top:32px;padding-top:8px}a{color:#185742}small{overflow-wrap:anywhere}
</style></head><body><main>
<header><small>栖光谷 · 离线家庭纪念册</small><h1>${escape(data.name)}</h1><p>${locations[site].label}${data.courtyard ? ' · 家庭庭院' : ''}</p></header>
<img class="portrait" alt="纪念照片" src="data:image/webp;base64,${bytes64(cover)}"><p>${escape(data.story)}</p>
<section><h2>它的园址</h2>${views.map(vista).join('')}</section>
<section><h2>家庭相册</h2>${photos.map(picture).join('') || '<p>这份档案仅含上方纪念照片。</p>'}</section>
<section><h2>探访与寄语</h2><p>免费花束共 ${data.flowers.length} 束。</p><ul>${lines}</ul></section>
<footer><p>导出日期 ${dateLabel(data.exportedAt)} · 档案 ${escape(data.id)}</p><a download="memorial.json" href="data:application/json;base64,${download}">保存机器可读档案及原图校验值</a></footer>
</main></body></html>`;
}

import './gardens.css';

export async function request(path, { method = 'GET', body } = {}) {
  const options = { method, credentials: 'same-origin', cache: 'no-store' };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  let result;
  try { result = await fetch(path, options); }
  catch { throw new Error('暂时连接不到花园，请检查网络后重试。'); }
  const data = await result.json().catch(() => null);
  if (!data) throw new Error('持久保存与分享需要连接花园服务。');
  if (!result.ok) throw new Error(data.error || '未能完成，请重试。');
  return data;
}
const placeName = place => place === 'entrance' ? '西南 · 桦坡' : '南岸 · 河湾';
const make = (tag, content, className) => {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
};
function action(label, handler, primary = false) {
  const node = make('button', label, primary ? 'garden-btn primary' : 'garden-btn');
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}
export async function showPublicGardens(body, { openGarden, isCurrent, visitSample }) {
  const sample = make('article', '', 'entry');
  sample.innerHTML = '<img src="/pet.webp" alt="草地上的金毛犬麦子"><div><small>河湾 · 示例纪念</small><h3>麦子</h3><p>从前沿河散步，你总会在水边停下来，等我跟上。今天也陪你在这里坐一会儿。</p></div>';
  sample.lastElementChild.append(action('去石前看看', visitSample));
  const area = make('section', '', 'public-gardens');
  area.append(make('h3', '公开的花园'));
  const status = make('p', '正在读取…', 'garden-status');
  area.append(status);
  body.replaceChildren(sample, area);
  try {
    const { gardens } = await request('/api/public');
    if (!isCurrent()) return;
    const example = gardens.find(garden => garden.id === 'demo-riverbend');
    if (example) {
      const visit = action('探访麦子 · 免费献花', () => openGarden(example.id), true);
      sample.lastElementChild.querySelector('button').replaceWith(visit);
    }
    const directory = gardens.filter(garden => garden !== example);
    status.textContent = directory.length ? '' : '这里会展示主人愿意与大家分享的花园。';
    for (const garden of directory) {
      const card = make('button', '', 'directory-entry');
      const image = new Image();
      image.alt = ''; image.loading = 'lazy'; image.src = garden.photoUrl;
      const text = make('span', '');
      text.append(make('small', placeName(garden.place)), make('strong', garden.name));
      card.append(image, text);
      card.onclick = () => openGarden(garden.id);
      area.append(card);
    }
  } catch (error) { if (isCurrent()) status.textContent = error.message; }
}
const pendingFlowers = new Map();
function flowerId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
}
export function renderGarden(body, garden, { changed, goWalk, isCurrent }) {
  const frame = make('article', '', 'garden-record');
  const photo = new Image();
  photo.src = garden.photoUrl;
  photo.alt = garden.name + '的照片';
  const text = make('div', '', 'garden-text');
  text.append(make('small', placeName(garden.place)), make('h3', garden.name));
  if (garden.story) text.append(make('p', garden.story, 'memory'));
  const flowers = make('p', garden.flowerCount ? '石前收到了 ' + garden.flowerCount + ' 束花。' : '石前还没有花束。', 'flower-total');
  text.append(flowers);
  const actions = make('div', '', 'garden-actions');
  const status = make('p', '', 'garden-status');
  status.setAttribute('role', 'status');
  const endpoint = '/api/gardens/' + encodeURIComponent(garden.id);
  async function write(path, options, message) {
    if (frame.getAttribute('aria-busy') === 'true') return;
    frame.setAttribute('aria-busy', 'true');
    const buttons = Array.from(body.querySelectorAll('button'));
    buttons.forEach(button => button.disabled = true);
    try {
      const data = await request(path, options);
      if (path.endsWith('/flowers')) pendingFlowers.delete(garden.id);
      if (isCurrent()) changed(data.garden, message);
    } catch (error) {
      if (isCurrent()) status.textContent = error.message;
    } finally {
      frame.removeAttribute('aria-busy');
      buttons.forEach(button => button.disabled = false);
    }
  }
  if (garden.isPublic && garden.acceptsFlowers) {
    actions.append(action('免费献花', () => {
      if (!pendingFlowers.has(garden.id)) pendingFlowers.set(garden.id, flowerId());
      write(endpoint + '/flowers', { method: 'POST', body: { requestId: pendingFlowers.get(garden.id) } }, '一束雏菊已放在石前。');
    }, true));
  }
  actions.append(action('到花园看看', goWalk, !actions.children.length));
  text.append(actions);
  frame.append(photo, text);
  body.replaceChildren(frame);
  const settings = make('section', '', 'garden-settings');
  if (garden.isOwner) {
    settings.append(make('h3', '探访设置'), make('p', garden.isPublic ? '已公开。访客可以看到照片和你写下的回忆。' : '仅自己可见。公开后，人们可以逛到这里，也可以通过链接探访。'));
    const buttons = make('div', '', 'garden-actions');
    buttons.append(action(garden.isPublic ? '转为私密' : '公开花园', () =>
      write(endpoint, { method: 'PATCH', body: { isPublic: !garden.isPublic } }, garden.isPublic ? '花园已转为私密。' : '花园已公开，可以分享了。')));
    if (garden.isPublic) buttons.append(action(garden.acceptsFlowers ? '关闭收花' : '开启收花', () =>
      write(endpoint, { method: 'PATCH', body: { acceptsFlowers: !garden.acceptsFlowers } }, garden.acceptsFlowers ? '已关闭收花。' : '已开启收花。')));
    settings.append(buttons);
    body.append(settings);
  }
  if (garden.isPublic) {
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set('garden', garden.id);
    const share = make('div', '', 'garden-share');
    const input = make('input', '');
    input.readOnly = true; input.value = url.href;
    input.setAttribute('aria-label', '花园分享地址');
    share.append(input, action('复制分享链接', async () => {
      try { await navigator.clipboard.writeText(input.value); status.textContent = '分享链接已复制。'; }
      catch { input.focus(); input.select(); status.textContent = '地址已选中，请复制分享。'; }
    }));
    body.append(share);
    if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      body.append(make('p', '当前地址仅在这台电脑上可访问。跨设备探访时，请从双方都能访问的服务器地址分享。', 'garden-status'));
    }
  }
  body.append(status);
  return status;
}

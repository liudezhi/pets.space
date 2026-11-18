import { places } from './places.js';
import './owner.css';

const sites = [
  { id: 'stone', name: '河湾', detail: '面向缓流，石边能听见水声。' },
  { id: 'entrance', name: '桦坡', detail: '面向草甸，在白桦下晒一会儿太阳。' },
].map(site => ({ ...site, image: places.find(place => place.id === site.id).image }));

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, handler, primary = false) {
  const node = element('button', primary ? 'owner-primary' : 'owner-secondary', label);
  node.type = 'button';
  node.onclick = handler;
  return node;
}

function submit(label) {
  const node = button(label, null, true);
  node.type = 'submit';
  return node;
}

function field(title, input) {
  const label = element('label', 'owner-field');
  label.append(element('span', '', title), input);
  return label;
}

function photo(src, alt) {
  const image = element('img');
  image.alt = alt;
  image.src = src;
  return image;
}

function alertLine() {
  const node = element('p', 'owner-alert');
  node.setAttribute('role', 'alert');
  return node;
}

async function preparePhoto(file) {
  const signatures = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const startsWith = (bytes, offset = 0) => bytes.every((byte, i) => signatures[offset + i] === byte);
  const jpeg = startsWith([0xff, 0xd8, 0xff]);
  const png = startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8);
  if (!jpeg && !png && !webp) throw new Error('请选择 JPEG、PNG 或 WebP 格式的照片。');
  if (file.size > 16 * 1024 * 1024) throw new Error('这张照片超过 16 MB，请选用较小的照片。');
  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    image.src = url;
    try { await image.decode(); } catch { throw new Error('无法读取这张照片，请重新选择。'); }
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法处理照片，请换用支持画布的浏览器。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let result = canvas.toDataURL('image/webp', 0.83);
    if (result.length > 2 * 1024 * 1024) result = canvas.toDataURL('image/webp', 0.64);
    if (!result.startsWith('data:image/webp;base64,')) throw new Error('当前浏览器无法生成 WebP 照片，请更换浏览器再试。');
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function showOwner(body, { openGarden, setTitle, request, isCurrent }) {
  const root = element('div', 'owner-panel');
  root.tabIndex = -1;
  body.replaceChildren(root);
  const active = () => isCurrent() && root.isConnected;
  const render = (title, ...nodes) => {
    if (!active()) return;
    setTitle(title);
    root.replaceChildren(...nodes);
    root.closest('dialog')?.scrollTo(0, 0);
    const target = root.querySelector('[data-focus]') || root;
    target.focus({ preventScroll: true });
  };

  function access(restoring = false) {
    const form = element('form', 'owner-form');
    const intro = element('p', 'owner-intro', restoring
      ? '用上次保存的恢复码，在这台设备上继续管理花园。'
      : '目前开放建园测试。使用测试邀请码开通园主资格，本轮无需付款。');
    const input = element('input');
    input.type = 'password';
    input.required = true;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.autocapitalize = 'none';
    input.dataset.focus = '';
    const error = alertLine();
    const confirm = submit(restoring ? '恢复我的花园' : '开通测试资格');
    const change = button(restoring ? '改用邀请码' : '用恢复码登录', () => access(!restoring));
    const actions = element('div', 'owner-actions');
    actions.append(confirm, change);
    form.append(intro, field(restoring ? '恢复码' : '测试邀请码', input), error, actions);
    form.onsubmit = async event => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) { error.textContent = '请先填写凭证。'; input.focus(); return; }
      confirm.disabled = true;
      change.disabled = true;
      error.textContent = '';
      try {
        const response = await request(restoring ? '/api/restore' : '/api/session', {
          method: 'POST', body: restoring ? { key: value } : { code: value },
        });
        if (!active()) return;
        if (response.recoveryKey) recovery(response.recoveryKey, restoring);
        else await dashboard();
      } catch (failure) {
        if (active()) { error.textContent = failure.message; input.focus(); }
      } finally { confirm.disabled = false; change.disabled = false; }
    };
    render(restoring ? '恢复园主身份' : '成为测试园主', form);
  }

  function recovery(key, restored) {
    const detail = element('p', 'owner-intro', restored
      ? '恢复成功。旧恢复码已失效，请保存这份新码。持有它的人可以管理你的花园。'
      : '请将恢复码保存在安全的地方。换电脑时可用它找回花园；持有它的人可以管理你的花园。');
    const input = element('input', 'owner-key');
    input.readOnly = true;
    input.value = key;
    const confirm = button('我已保存，进入我的花园', dashboard, true);
    const copy = button('复制恢复码', async () => {
      try {
        await navigator.clipboard.writeText(key);
        copy.textContent = '已复制';
      } catch {
        input.focus();
        input.select();
        copy.textContent = '已选中，请手动复制';
      }
    });
    const actions = element('div', 'owner-actions');
    actions.append(copy, confirm);
    render('保存恢复码', detail, field('你的恢复码', input), actions);
  }

  async function dashboard() {
    render('我的花园', element('p', 'owner-intro', '正在读取花园…'));
    try {
      const { gardens } = await request('/api/mine');
      if (!active()) return;
      const list = element('ul', 'owner-gardens');
      for (const garden of gardens) {
        const item = element('li');
        const visit = button(garden.name, () => openGarden(garden.id));
        const site = sites.find(place => place.id === garden.place);
        if (site) visit.append(element('small', '', site.name));
        item.append(visit);
        list.append(item);
      }
      const create = button('新建纪念花园', () => edit({
        name: '', story: '', photo: '', place: 'stone',
        clientRequestId: Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''),
      }), true);
      const intro = element('p', 'owner-intro', gardens.length ? '选择一座花园，继续探访或管理。' : '为它选一处喜欢的地方，留下照片和想说的话。');
      render('我的花园', intro, list, create);
    } catch (failure) {
      render('我的花园', element('p', 'owner-alert', failure.message), button('重新读取', dashboard));
    }
  }

  function edit(draft) {
    const form = element('form', 'owner-form');
    const siteField = element('fieldset', 'owner-site-field');
    const choices = element('div', 'owner-sites');
    siteField.append(element('legend', '', '选择园址'), choices);
    for (const site of sites) {
      const option = element('label', 'owner-site');
      const radio = element('input');
      radio.type = 'radio';
      radio.name = 'garden-place';
      radio.value = site.id;
      radio.checked = draft.place === site.id;
      radio.onchange = () => { draft.place = site.id; };
      const copy = element('span', 'owner-site-copy');
      copy.append(element('strong', '', site.name), element('small', '', site.detail));
      option.append(radio, photo(site.image, ''), copy);
      choices.append(option);
    }
    const name = element('input');
    name.name = 'name';
    name.required = true;
    name.maxLength = 40;
    name.value = draft.name;
    const story = element('textarea');
    story.name = 'story';
    story.rows = 3;
    story.maxLength = 2000;
    story.value = draft.story;
    const picker = element('input');
    picker.type = 'file';
    picker.accept = 'image/jpeg,image/png,image/webp';
    const evidence = element('div', 'owner-file-state');
    evidence.setAttribute('aria-live', 'polite');
    if (draft.photo) evidence.append(photo(draft.photo, '已选的宠物照片'));
    const preview = submit('私密预览');
    const error = alertLine();
    let changeVersion = 0;
    picker.onchange = async () => {
      const selected = picker.files[0];
      if (!selected) return;
      const version = ++changeVersion;
      draft.photo = '';
      error.textContent = '';
      preview.disabled = true;
      evidence.textContent = '正在整理照片…';
      try {
        const processed = await preparePhoto(selected);
        if (version !== changeVersion || !active() || !form.isConnected) return;
        draft.photo = processed;
        evidence.replaceChildren(photo(processed, '已选的宠物照片'), element('span', '', '照片已就绪'));
      } catch (failure) {
        if (version !== changeVersion || !active() || !form.isConnected) return;
        error.textContent = failure.message;
        evidence.replaceChildren();
        picker.value = '';
      } finally {
        if (version === changeVersion) preview.disabled = false;
      }
    };
    form.append(siteField, field('它的名字', name), field('照片 · JPEG、PNG 或 WebP', picker), evidence, field('写给它的话（可留空）', story), error, preview);
    form.onsubmit = event => {
      event.preventDefault();
      draft.name = name.value.trim();
      draft.story = story.value.trim();
      if (!draft.name) { error.textContent = '请填写它的名字。'; name.focus(); return; }
      if (!draft.photo) { error.textContent = '请选择一张宠物照片。'; picker.focus(); return; }
      review(draft);
    };
    render('新建纪念花园', form);
  }

  function review(draft) {
    const site = sites.find(item => item.id === draft.place);
    const recap = element('article', 'owner-preview');
    const words = element('div');
    words.append(element('small', '', site.name), element('h3', '', draft.name));
    if (draft.story) words.append(element('p', '', draft.story));
    recap.append(photo(draft.photo, draft.name + '的照片'), words);
    const editButton = button('返回修改', () => edit(draft));
    const error = alertLine();
    const confirm = button('保存私密花园', async () => {
      confirm.disabled = true;
      editButton.disabled = true;
      error.textContent = '';
      confirm.textContent = '正在保存…';
      try {
        const { garden } = await request('/api/gardens', { method: 'POST', body: draft });
        if (active()) openGarden(garden.id);
      } catch (failure) {
        if (active()) error.textContent = failure.message;
      } finally {
        confirm.textContent = '保存私密花园';
        confirm.disabled = false;
        editButton.disabled = false;
      }
    }, true);
    const actions = element('div', 'owner-actions');
    actions.append(editButton, confirm);
    render('私密预览', recap, element('p', 'owner-intro', '保存后仅园主可见。你可以从花园里选择是否公开。'), error, actions);
  }

  async function start() {
    render('我的花园', element('p', 'owner-intro', '正在读取园主身份…'));
    try {
      const session = await request('/api/session');
      if (!active()) return;
      if (session.owner) await dashboard();
      else access();
    } catch (failure) {
      render('我的花园', element('p', 'owner-alert', failure.message), button('重新读取', start));
    }
  }
  await start();
}

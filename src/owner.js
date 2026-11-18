import { preparePhoto, readOriginal } from './photos.js';
import { places } from './places.js';
import { catalogue, checkout, listOrders } from './checkout.js';
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

export async function showOwner(body, { openGarden, setTitle, request, isCurrent, recoveryKey }) {
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

  let paymentMode;
  function access(restoring = false) {
    const form = element('form', 'owner-form');
    const intro = element('p', 'owner-intro', restoring
      ? '用上次保存的恢复码，在这台设备上继续管理花园。'
      : paymentMode === 'sandbox' ? '使用邀请码开通园主资格，基础建园测试价 ' + catalogue.foundation.price + '。本轮使用模拟结算，无真实扣款。'
      : '使用邀请码建立基础建园订单。结算前请核对金额与支付模式。');
    const input = element('input');
    input.type = 'password';
    input.required = true;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.autocapitalize = 'none';
    input.dataset.focus = '';
    const error = alertLine();
    const confirm = submit(restoring ? '恢复我的花园' : '验证邀请码并查看订单');
    const change = button(restoring ? '改用邀请码' : '用恢复码登录', () => access(!restoring));
    const actions = element('div', 'owner-actions');
    actions.append(confirm, change);
    form.append(intro, field(restoring ? '恢复码' : paymentMode === 'sandbox' ? '测试邀请码' : '建园邀请码', input), error, actions);
    form.onsubmit = async event => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) { error.textContent = '请先填写凭证。'; input.focus(); return; }
      confirm.disabled = true;
      change.disabled = true;
      error.textContent = '';
      try {
        if (!restoring) { orderScreen('foundation', value); return; }
        const response = await request('/api/restore', { method: 'POST', body: { key: value } });
        if (!active()) return;
        if (response.recoveryKey) recovery(response.recoveryKey, restoring);
        else await dashboard();
      } catch (failure) {
        if (active()) { error.textContent = failure.message; input.focus(); }
      } finally { confirm.disabled = false; change.disabled = false; }
    };
    render(restoring ? '恢复园主身份' : paymentMode === 'sandbox' ? '成为测试园主' : '成为园主', form);
    if (!restoring) historyFor('foundation');
  }

  function historyFor(...products) {
    listOrders(root, { request, filter: order => products.includes(order.product),
      resume: order => orderScreen(order.product, undefined, order) });
  }

  function orderScreen(product, inviteCode, existing) {
    const area = element('div');
    render('订单结算', area);
    checkout(area, { request, product, inviteCode, existing, isCurrent: active,
      onLater: start,
      onPaid: async result => {
        if (!active()) return;
        if (result.recoveryKey) recovery(result.recoveryKey, false);
        else await dashboard();
      },
    });
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
      const [{ gardens }, { courtyard }] = await Promise.all([request('/api/mine'), request('/api/courtyard')]);
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
      const family = element('section', 'garden-settings');
      family.append(element('h3', '', '家庭庭院'));
      if (courtyard) {
        const members = gardens.filter(garden => courtyard.gardenIds.includes(garden.id));
        family.append(element('p', '', members.length ? '住在这里的伙伴' : '庭院已开通。打开自己的纪念地后可将它加入庭院。'));
        const links = element('div', 'garden-actions');
        for (const member of members) links.append(button(member.name, () => openGarden(member.id)));
        family.append(links);
      } else {
        family.append(element('p', '', catalogue.courtyard.detail), button('升级家庭庭院 · ' + catalogue.courtyard.price, () => orderScreen('courtyard')));
      }
      render('我的花园', intro, list, create, family);
      historyFor('courtyard', 'foundation');
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
    const preserve = element('input');
    preserve.type = 'checkbox';
    preserve.disabled = Boolean(draft.photo && !draft.originalFile);
    preserve.checked = !preserve.disabled && draft.keepOriginal !== false;
    preserve.onchange=()=>{ draft.keepOriginal=preserve.checked; };
    const preview = submit('私密预览');
    const error = alertLine();
    let changeVersion = 0;
    picker.onchange = async () => {
      const selected = picker.files[0];
      if (!selected) return;
      const version = ++changeVersion;
      draft.photo = '';
      draft.originalFile = undefined;
      error.textContent = '';
      preview.disabled = true;
      evidence.textContent = '正在整理照片…';
      try {
        const { preview: processed, mime } = await preparePhoto(selected);
        const originalFile = selected.size <= 8 * 1024 * 1024 ? await readOriginal(selected, mime) : undefined;
        if (version !== changeVersion || !active() || !form.isConnected) return;
        draft.photo = processed;
        draft.originalFile = originalFile;
        preserve.disabled = !originalFile;
        preserve.checked=!!originalFile && draft.keepOriginal!==false;
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
    form.append(siteField, field('它的名字', name), field('照片 · JPEG、PNG 或 WebP', picker), evidence, field('同时私密保存原始照片（8 MiB 以内）', preserve), field('写给它的话（可留空）', story), error, preview);
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
        const { garden } = await request('/api/gardens', { method: 'POST', body: { ...draft, originalFile: draft.keepOriginal===false ? undefined : draft.originalFile } });
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
    render('私密预览', recap, element('p', 'owner-intro', '保存后仅园主可见。你可以选择是否公开，还可以在家庭相册中管理照片原件。'), error, actions);
  }

  async function start() {
    render('我的花园', element('p', 'owner-intro', '正在读取园主身份…'));
    try {
      const session = await request('/api/session');
      if (!active()) return;
      paymentMode = session.paymentMode ?? 'sandbox';
      if (session.owner) await dashboard();
      else access();
    } catch (failure) {
      render('我的花园', element('p', 'owner-alert', failure.message), button('重新读取', start));
    }
  }
  if (recoveryKey) recovery(recoveryKey, false);
  else await start();
}

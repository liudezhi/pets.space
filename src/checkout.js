import { products } from '../shared/catalogue.mjs';

// Persisted orders can retain an earlier price. Their checkout page always shows the stored amount.
export const catalogue = Object.fromEntries(Object.entries(products).map(([key, item]) => [
  key, { ...item, price: '¥' + item.amountFen / 100 },
]));

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function click(label, callback, primary = false) {
  const element = node('button', label, primary ? 'garden-btn primary' : 'garden-btn');
  element.type = 'button';
  element.onclick = callback;
  return element;
}

function newRequestId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function orderAmount(order) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: order.currency }).format(order.amountFen / 100);
}

const checkoutModes = {
  sandbox: { title: '测试结算', button: '确认模拟付款', note: '本地模拟付款，不会扣款。' },
  'stripe-test': { title: 'Stripe 测试结算', button: '前往 Stripe 测试收银台', note: '本次使用 Stripe 测试环境，无真实扣款。' },
  'stripe-live': { title: 'Stripe 正式结算', button: '前往 Stripe 付款', note: '这是正式订单。在 Stripe 收银台确认支付将产生实际费用。' },
};

export function checkoutMode(mode) {
  if (!Object.hasOwn(checkoutModes, mode)) throw new Error('此订单的结算方式暂不可用，请稍后查询。');
  return checkoutModes[mode];
}

function hostedUrl(value) {
  const url = new URL(value);
  if (url.origin !== 'https://checkout.stripe.com' || url.username || url.password) {
    throw new Error('收银台地址无效，请重试原订单。');
  }
  return url.href;
}

// All information about payment and entitlement is read from the buyer's server-side session.
export function checkout(host, { request, product, inviteCode, gardenId, gardenName, existing, returned, isCurrent, onPaid, onLater }) {
  const section = node('section', '', 'garden-checkout');
  section.tabIndex = -1;
  host.replaceChildren(section);
  section.focus();
  section.scrollIntoView({ block: 'nearest' });
  const active = () => section.isConnected && isCurrent();
  const item = catalogue[product];
  const title = node('h3', item.name);
  const price = node('p', '', 'order-price');
  const note = node('p', '', 'garden-status');
  const status = node('p', '正在读取订单…', 'garden-status');
  status.setAttribute('role', 'status');
  const buttons = node('div', '', 'garden-actions');
  section.append(title, price, node('p', item.detail));
  if (gardenName) section.append(node('p', '赠予「' + gardenName + '」'));
  section.append(note, status, buttons);
  let order = existing;
  let availableMode;
  let checks = 0;
  let timer;
  const requestId = newRequestId();
  const endpoint = () => '/api/orders/' + encodeURIComponent(order.id);
  const later = () => { clearTimeout(timer); onLater(order); };
  const retry = (message, handler) => {
    clearTimeout(timer);
    status.textContent = message;
    buttons.replaceChildren(click('稍后再看', later), click('重试原订单', handler, true));
  };

  async function showOrder() {
    if (!active()) return;
    buttons.replaceChildren();
    const mode = checkoutMode(order.mode);
    title.textContent = item.name + ' · ' + mode.title;
    note.textContent = mode.note + ' 中断后可在本浏览器继续。百年存续是园区的运营目标。';
    price.textContent = orderAmount(order);
    if (order.status === 'needs_review') {
      status.textContent = '服务端已收到付款，暂时无法发放权益。请联系园区核对订单和退款，订单号 ' + order.id + '。';
      buttons.append(click('稍后再看', later), click('查询处理状态', refresh));
      return;
    }
    if (order.status === 'paid') {
      if (returned) { await pay(); return; }
      status.textContent = '此订单已完成。';
      buttons.append(click('稍后再看', later), click('查看结果', pay, true));
      return;
    }
    if (order.status !== 'pending') throw new Error('订单状态暂不可用，请重新查询。');
    if (order.mode !== availableMode) {
      note.textContent = '这张订单的收银台当前未启用，保留原订单供查询。';
      status.textContent = '订单尚待确认。';
      buttons.append(click('稍后再看', later), click('查询付款状态', refresh));
      return;
    }
    const checkingPayment = returned === 'success';
    status.textContent = checkingPayment
      ? '正在等待收款确认。若已完成付款，可在此查询原订单。'
      : returned === 'cancel' ? '已返回花园，订单仍待付款。可以继续结算或稍后再来。' : '订单已保存，请核对金额和结算方式。';
    buttons.append(click('稍后再看', later));
    if (order.mode !== 'sandbox') buttons.append(click('查询付款状态', refresh));
    if (!checkingPayment) buttons.append(click(mode.button, pay, true));
    if (checkingPayment && checks < 4) timer = setTimeout(refresh, 1800);
  }

  async function refresh() {
    clearTimeout(timer);
    if (!active()) return;
    buttons.replaceChildren();
    status.textContent = '正在查询原订单…';
    try {
      checks++;
      const data = await request(endpoint());
      order = data.order;
      await showOrder();
    } catch (error) { if (active()) retry(error.message, refresh); }
  }

  async function prepare() {
    try {
      const session = await request('/api/session');
      availableMode = session.paymentMode ?? 'sandbox';
      if (!order) {
        checkoutMode(availableMode);
        const { orders } = await request('/api/orders');
        order = orders.find(entry => entry.status === 'pending' && entry.mode === availableMode && entry.product === product &&
          (entry.gardenId || null) === (gardenId || null));
        if (!order && active()) {
          const data = await request('/api/orders', { method: 'POST', body: { product, requestId, gardenId, inviteCode } });
          order = data.order;
        }
      }
      await showOrder();
    } catch (error) { if (active()) retry(error.message, prepare); }
  }

  async function pay() {
    clearTimeout(timer);
    buttons.replaceChildren();
    status.textContent = order.status === 'paid' ? '正在领取订单结果…' : '正在连接收银台…';
    try {
      const result = await request(endpoint() + '/pay', { method: 'POST', body: {} });
      if (!active()) return;
      if (result.order?.id !== order.id || result.order.mode !== order.mode) throw new Error('订单信息已变更，请查询原订单。');
      order = result.order;
      if (order.status === 'paid') { await onPaid(result); return; }
      if (order.status === 'needs_review') { await showOrder(); return; }
      if (order.status !== 'pending' || order.mode === 'sandbox' || !result.checkoutUrl) {
        throw new Error('付款尚未确认，请查询原订单。');
      }
      window.location.assign(hostedUrl(result.checkoutUrl));
    } catch (error) { if (active()) retry(error.message, refresh); }
  }
  prepare();
}

export async function checkoutReturn(host, { id, returned, request, isCurrent, onPaid, onLater }) {
  const loading = node('p', '正在核对订单…', 'garden-status');
  host.replaceChildren(loading);
  try {
    const { order } = await request('/api/orders/' + encodeURIComponent(id));
    if (!isCurrent()) return;
    if (order.id !== id || !Object.hasOwn(catalogue, order.product) || !['stripe-test', 'stripe-live'].includes(order.mode)) {
      throw new Error('没有可在此确认的托管支付订单。');
    }
    checkout(host, { request, product: order.product, existing: order, returned, isCurrent, onPaid, onLater });
  } catch (error) {
    if (!isCurrent()) return;
    loading.textContent = error.message;
    host.append(click('重新查询', () => checkoutReturn(host, { id, returned, request, isCurrent, onPaid, onLater })), click('返回花园', () => onLater(null)));
  }
}

export async function listOrders(host, { request, filter, resume }) {
  const details = node('details', '', 'order-history');
  const summary = node('summary', '本浏览器的订单');
  const list = node('div', '', 'order-list');
  const status = node('p', '', 'garden-status');
  status.setAttribute('role', 'status');
  details.append(summary, status, list);
  host.append(details);
  let loadId = 0;
  async function load() {
    const version = ++loadId;
    list.replaceChildren();
    status.textContent = '正在读取…';
    try {
      await request('/api/session');
      const { orders } = await request('/api/orders');
      if (!details.isConnected || version !== loadId) return;
      const entries = orders.filter(filter);
      status.textContent = entries.length ? '' : '还没有相关订单。';
      for (const order of entries) {
        const row = node('div', '', 'order-row');
        const name = catalogue[order.product]?.name || '纪念商品';
        row.append(node('span', name + ' · ' + orderAmount(order) + ' · ' + (checkoutModes[order.mode]?.title || '待核对')));
        if (order.status === 'needs_review') row.append(click('款项待人工核对', () => resume(order)));
        else if (order.status === 'pending' || order.product === 'foundation') {
          row.append(click(order.status === 'paid' ? '查看开通结果' : '继续结算', () => resume(order)));
        } else row.append(node('small', '已完成'));
        list.append(row);
      }
    } catch (error) {
      if (!details.isConnected || version !== loadId) return;
      status.textContent = error.message;
      list.append(click('重新读取', load));
    }
  }
  details.ontoggle = () => { if (details.open) load(); };
}

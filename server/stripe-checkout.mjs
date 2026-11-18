import { createHmac, timingSafeEqual } from 'node:crypto';

const productNames = Object.freeze({
  foundation: '栖光谷 · 基础建园',
  courtyard: '栖光谷 · 家庭庭院',
  lily: '栖光谷 · 百合花束（7 天）',
  vase: '栖光谷 · 纪念花瓶',
});

const supportedEvents = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.expired',
]);

function hostedOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Stripe 需要配置网站的 HTTPS 公共源站。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Stripe 公共源站需要是无路径的 HTTPS 地址。');
  }
  return url.origin;
}

export function createPaymentProvider(configuration = {}, reject) {
  const mode = configuration.mode ?? 'sandbox';
  if (mode === 'sandbox') return { mode };
  if (!['stripe-test', 'stripe-live'].includes(mode)) throw new Error('支付模式无效。');
  const live = mode === 'stripe-live';
  const expectedKey = live ? /^sk_live_[a-zA-Z0-9_]+$/ : /^sk_test_[a-zA-Z0-9_]+$/;
  const { secretKey, webhookSecret } = configuration;
  if (!expectedKey.test(secretKey) || !/^whsec_[a-zA-Z0-9_]+$/.test(webhookSecret)) {
    throw new Error('Stripe 凭据缺失或与当前模式不符。');
  }
  const origin = hostedOrigin(configuration.publicOrigin);
  const stripeFetch = configuration.fetch ?? globalThis.fetch;
  const prefix = live ? 'cs_live_' : 'cs_test_';
  const inFlight = new Map();

  function validSession(session) {
    return session && session.object === 'checkout.session' && session.mode === 'payment' &&
      session.livemode === live && typeof session.id === 'string' &&
      session.id.startsWith(prefix) && /^[a-zA-Z0-9_]{8,255}$/.test(session.id);
  }

  async function createRemote(order, attempt) {
    // The browser supplies neither the amount nor the destination origin.
    const fields = new URLSearchParams({
      mode: 'payment',
      'payment_method_types[0]': 'card',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'cny',
      'line_items[0][price_data][unit_amount]': String(order.amountFen),
      'line_items[0][price_data][product_data][name]': productNames[order.product],
      'metadata[order_id]': order.id, 'metadata[product]': order.product, 'metadata[mode]': mode,
      client_reference_id: order.id,
      success_url: origin + '/?checkout=success&order=' + order.id,
      cancel_url: origin + '/?checkout=cancel&order=' + order.id,
    });
    let remote;
    try {
      const response = await stripeFetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST', body: fields, redirect: 'error', signal: AbortSignal.timeout(12_000),
        headers: {
          Authorization: 'Bearer ' + secretKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Stripe-Version': '2024-06-20',
          'Idempotency-Key': 'qiguang/' + mode + '/' + order.id + '/' + attempt,
        },
      });
      if (!response.ok) throw new Error();
      remote = await response.json();
    } catch {
      reject(502, '暂时无法连接托管收银台，可以稍后继续这张订单。');
    }
    if (!validSession(remote) || remote.status !== 'open') reject(502, '托管收银台返回了无效会话。');
    let url;
    try { url = new URL(remote.url); } catch { reject(502, '托管收银台地址无效。'); }
    if (url.origin !== 'https://checkout.stripe.com' || url.username || url.password) {
      reject(502, '托管收银台地址无效。');
    }
    return { sessionId: remote.id, checkoutUrl: url.href };
  }

  async function checkout(commerce, prepared) {
    if (prepared.checkoutUrl) return prepared.checkoutUrl;
    const { order, attempt } = prepared;
    const key = order.id + '/' + attempt;
    let promise = inFlight.get(key);
    if (!promise) {
      promise = createRemote(order, attempt).then(remote => {
        commerce.bindCheckout({ id: order.id, mode, attempt, ...remote });
        return remote.checkoutUrl;
      });
      inFlight.set(key, promise);
    }
    try { return await promise; }
    finally { if (inFlight.get(key) === promise) inFlight.delete(key); }
  }

  function verify(raw, signature) {
    const invalid = () => reject(400, '支付通知的签名或时间无效。');
    if (typeof signature !== 'string' || signature.length > 4096) invalid();
    const fields = signature.split(',').map(v => v.trim());
    const stamps = fields.filter(v => /^t=\d{1,12}$/.test(v)).map(v => v.slice(2));
    if (stamps.length !== 1 || Math.abs(Math.floor(Date.now() / 1000) - Number(stamps[0])) > 300) invalid();
    const expected = createHmac('sha256', webhookSecret).update(stamps[0] + '.').update(raw).digest();
    const valid = fields.filter(v => /^v1=[a-f\d]{64}$/i.test(v))
      .some(v => timingSafeEqual(expected, Buffer.from(v.slice(3), 'hex')));
    if (!valid) invalid();
  }

  function webhook(raw, signature, commerce) {
    verify(raw, signature);
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { reject(400, '支付通知格式无效。'); }
    if (event?.object !== 'event' || event.livemode !== live || typeof event.type !== 'string') {
      reject(400, '支付通知与当前环境不匹配。');
    }
    if (!supportedEvents.has(event.type)) return;
    const session = event.data?.object;
    if (!validSession(session) || !session.metadata || session.metadata.mode !== mode ||
        !Object.hasOwn(productNames, session.metadata.product) ||
        typeof session.metadata.order_id !== 'string' ||
        session.metadata.order_id !== session.client_reference_id ||
        !Number.isSafeInteger(session.amount_total) || session.amount_total <= 0 || session.currency !== 'cny') {
      reject(400, '支付通知缺少正确的订单信息。');
    }
    const receipt = {
      id: session.client_reference_id, mode, sessionId: session.id, amountFen: session.amount_total,
      product: session.metadata.product, currency: 'CNY',
    };
    if (event.type === 'checkout.session.expired') {
      if (session.status !== 'expired' || session.payment_status !== 'unpaid') reject(400, '支付会话状态不匹配。');
      commerce.expireCheckout(receipt);
      return;
    }
    if (session.status !== 'complete') reject(400, '支付会话尚未完成。');
    if (session.payment_status !== 'paid') {
      if (event.type === 'checkout.session.completed' && session.payment_status === 'unpaid') return;
      reject(400, '支付通知尚未确认款项。');
    }
    commerce.fulfillCheckout(receipt);
  }
  return { mode, checkout, webhook };
}

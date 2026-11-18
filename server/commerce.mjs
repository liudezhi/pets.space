import { randomUUID } from 'node:crypto';

import { products, lilyDays } from '../shared/catalogue.mjs';
const DAY = 86_400_000;
const MODES = new Set(['sandbox', 'stripe-test', 'stripe-live']);

function presentOrder(row) {
  return {
    id: row.id, product: row.product, status: row.review_received_at == null ? row.status : 'needs_review', amountFen: row.amount_fen,
    currency: 'CNY', mode: row.payment_mode, gardenId: row.garden,
    createdAt: new Date(row.created_at).toISOString(),
    paidAt: (row.paid_at ?? row.review_received_at) == null ? null : new Date(row.paid_at ?? row.review_received_at).toISOString(),
  };
}

export function createCommerce({ db, sql, transaction, reject }) {
  transaction(() => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS commerce_orders (
      id TEXT PRIMARY KEY,
      buyer_hash TEXT NOT NULL,
      request_id TEXT NOT NULL,
      product TEXT NOT NULL CHECK(product IN ('foundation','lily','vase','courtyard')),
      garden TEXT,
      owner TEXT REFERENCES owners(id),
      amount_fen INTEGER NOT NULL CHECK(amount_fen > 0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('paid','pending')),
      created_at INTEGER NOT NULL,
      paid_at INTEGER,
      expires_at INTEGER,
      UNIQUE(buyer_hash,request_id),
      CHECK ((status = 'pending') = (paid_at IS NULL)),
      CHECK ((product IN ('lily','vase')) = (garden IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS commerce_single_foundation
      ON commerce_orders(buyer_hash) WHERE product='foundation' AND status='paid';
    CREATE UNIQUE INDEX IF NOT EXISTS commerce_single_courtyard
      ON commerce_orders(owner) WHERE product='courtyard' AND status='paid';
    CREATE INDEX IF NOT EXISTS commerce_gifts
      ON commerce_orders(garden,paid_at) WHERE status='paid' AND garden IS NOT NULL;
    CREATE TABLE IF NOT EXISTS courtyards (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL UNIQUE REFERENCES owners(id),
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS courtyard_members (
      garden TEXT PRIMARY KEY REFERENCES gardens(id) ON DELETE CASCADE,
      courtyard TEXT NOT NULL REFERENCES courtyards(id)
    );
    CREATE INDEX IF NOT EXISTS courtyard_members_by_courtyard ON courtyard_members(courtyard);
    CREATE TRIGGER IF NOT EXISTS release_courtyard_on_transfer
      AFTER UPDATE OF owner ON gardens WHEN OLD.owner != NEW.owner
      BEGIN
        DELETE FROM courtyard_members WHERE garden=NEW.id;
      END;
    CREATE TABLE IF NOT EXISTS stripe_checkouts (
      order_id TEXT PRIMARY KEY REFERENCES commerce_orders(id) ON DELETE CASCADE,
      attempt INTEGER NOT NULL DEFAULT 1 CHECK(attempt > 0),
      recovery_hash BLOB,
      session_id TEXT UNIQUE,
      checkout_url TEXT
    );
    CREATE TABLE IF NOT EXISTS stripe_expired_sessions (
      session_id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES commerce_orders(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS courtyard_checkout_reservations (
      owner TEXT PRIMARY KEY REFERENCES owners(id),
      order_id TEXT NOT NULL UNIQUE REFERENCES commerce_orders(id) ON DELETE CASCADE,
      reserved_at INTEGER NOT NULL
    );
  `);
    const columns = new Set(db.prepare('PRAGMA table_info(commerce_orders)').all().map(column => column.name));
    // A snapshot created before hosted checkout only contains simulated orders.
    if (!columns.has('payment_mode')) db.exec("ALTER TABLE commerce_orders ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'sandbox' CHECK(payment_mode IN ('sandbox','stripe-test','stripe-live'))");
    if (!columns.has('review_received_at')) db.exec('ALTER TABLE commerce_orders ADD COLUMN review_received_at INTEGER');
    if (!columns.has('review_reason')) db.exec('ALTER TABLE commerce_orders ADD COLUMN review_reason TEXT');
    if (!columns.has('invite_hash')) db.exec('ALTER TABLE commerce_orders ADD COLUMN invite_hash TEXT');
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS single_hosted_invite ON commerce_orders(payment_mode,invite_hash)
      WHERE product='foundation' AND invite_hash IS NOT NULL`);
    db.exec(`INSERT OR IGNORE INTO courtyard_checkout_reservations(owner,order_id,reserved_at)
      SELECT o.owner,o.id,o.created_at FROM commerce_orders o JOIN stripe_checkouts c ON c.order_id=o.id
      WHERE o.product='courtyard' AND o.status='pending' AND o.review_received_at IS NULL
        AND c.session_id IS NOT NULL ORDER BY o.created_at,o.id`);
  });

  function orderRow(id, buyerHash) {
    const row = sql('SELECT * FROM commerce_orders WHERE id=? AND buyer_hash=?').get(id, buyerHash);
    if (!row) reject(404, '未找到这笔订单。');
    return row;
  }

  function checkRecipient(id) {
    if (typeof id !== 'string' || !id) reject(400, '请选择接收礼物的纪念地。');
    const garden = sql('SELECT is_public, accepts_flowers FROM gardens WHERE id=?').get(id);
    if (!garden || !garden.is_public) reject(404, '未找到可接收礼物的公开纪念地。');
    if (!garden.accepts_flowers) reject(403, '这处纪念园暂不接收礼物。');
  }

  function checkFoundation(buyerHash, owner) {
    if (owner || sql("SELECT id FROM commerce_orders WHERE buyer_hash=? AND product='foundation' AND status='paid'").get(buyerHash)) {
      reject(409, '这位园主已经开通。');
    }
  }

  function checkCourtyard(owner) {
    if (!owner) reject(401, '请先以园主身份进入。');
    if (sql('SELECT id FROM courtyards WHERE owner=?').get(owner)) reject(409, '你的家庭庭院已开通。');
  }

  function create({ buyerHash, owner, product, gardenId = null, requestId, mode = 'sandbox', inviteHash = null }) {
    if (!MODES.has(mode)) reject(400, '未知支付模式。');
    if (!Object.hasOwn(products, product)) reject(400, '未知商品。');
    if (typeof requestId !== 'string' || !/^[\w-]{8,128}$/.test(requestId)) reject(400, '订单请求编号无效。');
    const hostedFoundation = product === 'foundation' && mode !== 'sandbox';
    if (hostedFoundation && (typeof inviteHash !== 'string' || !/^[a-f0-9]{64}$/.test(inviteHash))) {
      reject(401, '基础建园需要有效的邀请码。');
    }
    const isGift = product === 'lily' || product === 'vase';
    if (!isGift && gardenId !== null) reject(400, '该商品无需指定纪念地。');
    return transaction(() => {
      const existing = sql('SELECT * FROM commerce_orders WHERE buyer_hash=? AND request_id=?').get(buyerHash, requestId);
      if (existing) {
        if (existing.payment_mode !== mode || (hostedFoundation && existing.invite_hash !== inviteHash) || existing.product !== product || existing.garden !== gardenId || (product === 'courtyard' && existing.owner !== owner)) {
          reject(409, '这次请求的购买内容已经确定。');
        }
        return { order: presentOrder(existing), created: false };
      }
      if (isGift) checkRecipient(gardenId);
      if (product === 'foundation') checkFoundation(buyerHash, owner);
      if (product === 'courtyard') checkCourtyard(owner);
      if (!isGift && sql(`SELECT id FROM commerce_orders WHERE buyer_hash=? AND product=? AND status='pending'
            AND payment_mode=? AND owner IS ?`).get(buyerHash, product, mode, product === 'courtyard' ? owner : null)) {
        reject(409, '已有待付款的订单，请从未完成订单中继续。');
      }

      if (hostedFoundation && sql('SELECT id FROM commerce_orders WHERE payment_mode=? AND invite_hash=?').get(mode, inviteHash)) {
        reject(409, '邀请码已用于一笔开通订单。');
      }
      const id = randomUUID();
      sql(`INSERT INTO commerce_orders(id,buyer_hash,request_id,product,garden,owner,amount_fen,created_at,payment_mode,invite_hash)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, buyerHash, requestId, product, gardenId,
          product === 'courtyard' ? owner : null, products[product].amountFen, Date.now(), mode, hostedFoundation ? inviteHash : null);
      return { order: presentOrder(orderRow(id, buyerHash)), created: true };
    });
  }

  function paidResult(row, recoveryHash) {
    const order = presentOrder(row);
    if (row.product !== 'foundation') return { order };
    const match = recoveryHash && sql('SELECT id FROM owners WHERE id=? AND recovery_hash=?').get(row.owner, recoveryHash);
    return { order, ownerId: row.owner, canRecover: Boolean(match) };
  }

  function checkMode(row, mode, hosted = false) {
    if (!row) reject(404, '未找到这笔订单。');
    if (!MODES.has(mode) || row.payment_mode !== mode || (hosted && mode === 'sandbox')) {
      reject(409, '订单与当前支付环境不符。');
    }
  }

  function checkBuyer(row, owner) {
    if (row.product === 'courtyard' && (!owner || row.owner !== owner)) reject(403, '请以购买庭院时的园主身份确认。');
  }

  function checkEligibility(row, owner) {
    if (row.product === 'foundation') checkFoundation(row.buyer_hash, owner);
    else if (row.product === 'courtyard') {
      checkCourtyard(owner);
      const reservation = sql(`SELECT r.order_id,r.reserved_at,c.session_id FROM courtyard_checkout_reservations r
        JOIN stripe_checkouts c ON c.order_id=r.order_id WHERE r.owner=?`).get(owner);
      if (reservation && reservation.order_id !== row.id) {
        // An unbound session was never exposed to a buyer. Release an abandoned
        // creation after a short lease; a late bind must still hold this slot.
        if (reservation.session_id || reservation.reserved_at > Date.now() - 300_000) {
          reject(409, '这座庭院已在另一笔订单中结账，请先完成该订单或等待结账会话过期。');
        }
        sql('DELETE FROM courtyard_checkout_reservations WHERE order_id=?').run(reservation.order_id);
      }
    } else checkRecipient(row.garden);
  }

  function checkRecoveryHash(row, hash) {
    if (row.product === 'foundation' && (!(hash instanceof Uint8Array) || hash.length !== 32)) {
      throw new Error('开通园主需要有效的恢复钥匙摘要。');
    }
  }

  // Called only inside the transaction that verifies the buyer's simulator action
  // or a provider settlement. Validation precedes every entitlement write.
  function grant(row, recoveryHash) {
    const paidAt = Date.now();
    let beneficiary = row.owner;
    if (row.product === 'foundation') {
      checkRecoveryHash(row, recoveryHash);
      beneficiary = randomUUID();
      sql('INSERT INTO owners(id,recovery_hash) VALUES(?,?)').run(beneficiary, recoveryHash);
    } else if (row.product === 'courtyard') {
      sql('INSERT INTO courtyards(id,owner,name) VALUES(?,?,?)').run(randomUUID(), row.owner, '听风山庭');
      sql('DELETE FROM courtyard_checkout_reservations WHERE order_id=?').run(row.id);
      // Only abandoned simulated checkouts have no provider-side payment to reconcile.
      sql(`DELETE FROM commerce_orders WHERE owner=? AND product='courtyard' AND status='pending'
        AND payment_mode='sandbox' AND id<>?`).run(row.owner, row.id);
    }
    const expiresAt = row.product === 'lily' ? paidAt + lilyDays * DAY : null;
    sql("UPDATE commerce_orders SET owner=?,status='paid',paid_at=?,expires_at=? WHERE id=?")
      .run(beneficiary, paidAt, expiresAt, row.id);
  }

  function pay({ id, buyerHash, owner, recoveryHash, mode = 'sandbox' }) {
    return transaction(() => {
      const row = orderRow(id, buyerHash);
      checkMode(row, mode);
      checkBuyer(row, owner);
      if (row.status === 'paid') return paidResult(row, recoveryHash);
      if (row.payment_mode !== 'sandbox') reject(409, '需等待支付平台确认收款。');
      checkEligibility(row, owner);
      grant(row, recoveryHash);
      return paidResult(orderRow(id, buyerHash), recoveryHash);
    });
  }

  function prepareCheckout({ id, buyerHash, owner, mode, recoveryHash }) {
    return transaction(() => {
      const row = orderRow(id, buyerHash);
      checkMode(row, mode, true);
      checkBuyer(row, owner);
      if (row.status === 'paid' || row.review_received_at !== null) return { order: presentOrder(row) };
      checkEligibility(row, owner);
      checkRecoveryHash(row, recoveryHash);
      sql(`INSERT INTO stripe_checkouts(order_id,recovery_hash) VALUES(?,?)
        ON CONFLICT(order_id) DO NOTHING`).run(id, row.product === 'foundation' ? recoveryHash : null);
      if (row.product === 'courtyard') {
        sql(`INSERT INTO courtyard_checkout_reservations(owner,order_id,reserved_at) VALUES(?,?,?)
          ON CONFLICT(owner) DO UPDATE SET reserved_at=excluded.reserved_at
          WHERE courtyard_checkout_reservations.order_id=excluded.order_id`).run(owner, id, Date.now());
      }
      const checkout = sql('SELECT * FROM stripe_checkouts WHERE order_id=?').get(id);
      if (row.product === 'foundation' && !Buffer.from(checkout.recovery_hash).equals(recoveryHash)) {
        reject(409, '开通凭证与这笔订单不符。');
      }
      return { order: presentOrder(row), attempt: checkout.attempt, sessionId: checkout.session_id, checkoutUrl: checkout.checkout_url };
    });
  }

  function checkoutRow(id, mode) {
    const row = sql(`SELECT o.*,c.session_id,c.checkout_url,c.attempt,c.recovery_hash
      FROM commerce_orders o JOIN stripe_checkouts c ON c.order_id=o.id WHERE o.id=?`).get(id);
    checkMode(row, mode, true);
    return row;
  }

  function bindCheckout({ id, mode, attempt, sessionId, checkoutUrl }) {
    return transaction(() => {
      const row = checkoutRow(id, mode);
      if (row.status !== 'pending' || row.review_received_at !== null || (attempt != null && attempt !== row.attempt)) {
        reject(409, '结账会话已改变，请刷新订单。');
      }
      if (typeof sessionId !== 'string' || !sessionId || typeof checkoutUrl !== 'string' || !checkoutUrl) reject(400, '支付平台返回的会话无效。');
      if (row.product === 'courtyard' && !sql('SELECT owner FROM courtyard_checkout_reservations WHERE order_id=?').get(id)) {
        reject(409, '庭院结账预留已失效，请刷新订单。');
      }
      if (row.session_id && row.session_id !== sessionId) reject(409, '订单已绑定另一结账会话。');
      if (sql('SELECT order_id FROM stripe_expired_sessions WHERE session_id=?').get(sessionId)) reject(409, '该支付会话已过期。');
      if (sql('SELECT order_id FROM stripe_checkouts WHERE session_id=? AND order_id<>?').get(sessionId, id)) {
        reject(409, '支付会话已经使用。');
      }
      sql('UPDATE stripe_checkouts SET session_id=?, checkout_url=? WHERE order_id=?').run(sessionId, checkoutUrl, id);
      return { sessionId, checkoutUrl, attempt: row.attempt };
    });
  }

  function verifyDetails(row, { amountFen, currency, product }) {
    if (amountFen !== row.amount_fen || product !== row.product || typeof currency !== 'string' || currency.toLowerCase() !== 'cny') {
      reject(409, '支付商品、金额或币种与订单不符。');
    }
  }

  function verifySession(row, claims) {
    verifyDetails(row, claims);
    if (!claims.sessionId || row.session_id !== claims.sessionId) reject(409, '支付会话与订单不符。');
  }

  function expireCheckout(claims) {
    return transaction(() => {
      const row = checkoutRow(claims.id, claims.mode);
      verifyDetails(row, claims);
      if (typeof claims.sessionId !== 'string' || !claims.sessionId) reject(409, '支付会话与订单不符。');
      if (sql('SELECT session_id FROM stripe_expired_sessions WHERE session_id=? AND order_id=?').get(claims.sessionId, row.id)) {
        return { expired: false };
      }
      if (row.session_id !== claims.sessionId) reject(409, '支付会话与订单不符。');
      if (row.status !== 'pending' || row.review_received_at !== null) return { expired: false };
      sql('INSERT INTO stripe_expired_sessions(session_id,order_id) VALUES(?,?)').run(claims.sessionId, row.id);
      sql('UPDATE stripe_checkouts SET attempt=attempt+1,session_id=NULL,checkout_url=NULL WHERE order_id=?').run(row.id);
      sql('DELETE FROM courtyard_checkout_reservations WHERE order_id=?').run(row.id);
      return { expired: true };
    });
  }

  // The caller verifies the provider signature (or retrieves the session from
  // Stripe) and requires payment_status=paid before passing these claims.
  function fulfillCheckout(claims) {
    const { id, mode } = claims;
    return transaction(() => {
      const row = checkoutRow(id, mode);
      verifySession(row, claims);
      if (row.status === 'paid') return { status: 'paid' };
      if (row.review_received_at !== null) return { status: 'needs_review' };
      try {
        checkEligibility(row, row.owner);
      } catch (error) {
        // The provider already captured funds. Record the exception for refund
        // reconciliation and prevent either a second charge or a private placement.
        if (![401, 403, 404, 409].includes(error.status)) throw error;
        sql('UPDATE commerce_orders SET review_received_at=?,review_reason=? WHERE id=?')
          .run(Date.now(), error.message, id);
        sql('DELETE FROM courtyard_checkout_reservations WHERE order_id=?').run(id);
        return { status: 'needs_review' };
      }
      grant(row, row.recovery_hash);
      return { status: 'paid' };
    });
  }

  function giftRows(gardenId, cutoff) {
    const filter = cutoff == null ? '' : ' AND (expires_at IS NULL OR expires_at>?)';
    const args = cutoff == null ? [gardenId] : [gardenId, cutoff];
    return sql(`SELECT id,product,paid_at,expires_at FROM commerce_orders
      WHERE garden=? AND status='paid'` + filter + ' ORDER BY paid_at,rowid').all(...args).map(row => ({
        id: row.id, type: row.product, placedAt: new Date(row.paid_at).toISOString(),
        expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
      }));
  }

  function gardenCourtyard(gardenId) {
    const row = sql(`SELECT c.id,c.name FROM courtyard_members m JOIN courtyards c ON c.id=m.courtyard
      WHERE m.garden=?`).get(gardenId);
    return row ? { id: row.id, name: row.name } : null;
  }

  function visibleCourtyard(id, owner) {
    const row = sql('SELECT id,name,owner FROM courtyards WHERE id=?').get(id);
    if (!row) reject(404, '未找到这处庭院。');
    const gardenIds = sql(`SELECT g.id FROM courtyard_members m JOIN gardens g ON g.id=m.garden
      WHERE m.courtyard=? AND (g.is_public=1 OR g.owner=?) ORDER BY m.rowid`).all(id, owner ?? null).map(g => g.id);
    if (!gardenIds.length && row.owner !== owner) reject(404, '未找到这处庭院。');
    return { courtyard: { id: row.id, name: row.name, gardenIds }, gardenIds };
  }

  function myCourtyard(owner) {
    const row = sql('SELECT id FROM courtyards WHERE owner=?').get(owner ?? null);
    return row ? visibleCourtyard(row.id, owner).courtyard : null;
  }

  function setMember(gardenId, owner, enabled) {
    if (!owner) reject(401, '请先以园主身份进入。');
    if (typeof enabled !== 'boolean') reject(400, '请选择是否移入庭院。');
    // The caller may already be updating visibility in the same transaction.
    db.exec('SAVEPOINT change_courtyard_member');
    try {
      if (!sql('SELECT id FROM gardens WHERE id=? AND owner=?').get(gardenId, owner)) reject(404, '未找到这处纪念档案。');
      const courtyard = sql('SELECT id FROM courtyards WHERE owner=?').get(owner);
      if (!courtyard) reject(403, '请先开通家庭庭院。');
      if (enabled) {
        sql('INSERT INTO courtyard_members(garden,courtyard) VALUES(?,?) ON CONFLICT(garden) DO NOTHING').run(gardenId, courtyard.id);
      } else {
        sql('DELETE FROM courtyard_members WHERE garden=? AND courtyard=?').run(gardenId, courtyard.id);
      }
      db.exec('RELEASE change_courtyard_member');
    } catch (error) {
      db.exec('ROLLBACK TO change_courtyard_member; RELEASE change_courtyard_member');
      throw error;
    }
  }

  return {
    create, pay, prepareCheckout, bindCheckout, expireCheckout, fulfillCheckout, gardenCourtyard, visibleCourtyard, myCourtyard, setMember,
    gifts: gardenId => giftRows(gardenId, Date.now()),
    allGifts: gardenId => giftRows(gardenId, null),
    orders: buyerHash => sql('SELECT * FROM commerce_orders WHERE buyer_hash=? ORDER BY rowid DESC').all(buyerHash).map(presentOrder),
    order: (id, buyerHash) => presentOrder(orderRow(id, buyerHash)),
  };
}

// Бот «Путеводителя в японский»: подписка «Ханами» за Telegram Stars.
// Работает на Cloudflare Workers, без сервера и без внешних библиотек.
//
// Секреты (Workers → Settings → Variables and Secrets → тип Secret):
//   BOT_TOKEN       — токен бота от @BotFather
//   WEBHOOK_SECRET  — любая длинная случайная строка (Telegram присылает её с каждым запросом)
//   SETUP_KEY       — любая строка, нужна один раз, чтобы открыть /setup
//   FIREBASE_SA     — содержимое JSON-ключа сервисного аккаунта Firebase целиком
// Переменные (тип Text):
//   ADMIN_TG_ID     — твой числовой Telegram ID (узнать: @userinfobot)
//   PRICE_STARS     — цена подписки в звёздах, например 50
//   SITE_URL        — https://gallonnnnn.github.io/michi/
//   SUPPORT_CONTACT — куда писать по вопросам оплаты, например @твой_ник

const PERIOD = 2592000; // 30 дней — единственный период подписки, который разрешает Telegram
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/webhook' && request.method === 'POST') {
        if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
        const update = await request.json();
        await handleUpdate(update, env);
        return new Response('ok');
      }
      if (url.pathname === '/setup') {
        if (!env.SETUP_KEY || url.searchParams.get('key') !== env.SETUP_KEY) return new Response('forbidden', { status: 403 });
        return json(await setup(env, url.origin));
      }
      return new Response('Путеводитель в японский: бот работает 🌸');
    } catch (e) {
      console.error('Ошибка:', e && e.stack || e);
      // Ошибку при оплате отдаём как 500, чтобы Telegram повторил запрос. Повтор безопасен: платёж обрабатывается один раз.
      return new Response('error', { status: 500 });
    }
  },
};

// ===================== Telegram =====================
async function tg(env, method, params = {}) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
  return data.result;
}
const send = (env, chat_id, text, extra = {}) => tg(env, 'sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
const price = env => Math.max(1, parseInt(env.PRICE_STARS || '50', 10));
const site = env => env.SITE_URL || 'https://gallonnnnn.github.io/michi/';
const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function setup(env, origin) {
  const res = {};
  res.webhook = await tg(env, 'setWebhook', {
    url: origin + '/webhook', secret_token: env.WEBHOOK_SECRET,
    allowed_updates: ['message', 'pre_checkout_query'], drop_pending_updates: false,
  });
  res.commands = await tg(env, 'setMyCommands', { commands: [
    { command: 'start', description: 'Оформить «Ханами»' },
    { command: 'status', description: 'Моя подписка и код' },
    { command: 'code', description: 'Прислать мой последний код ещё раз' },
    { command: 'cancel', description: 'Отключить автопродление' },
    { command: 'terms', description: 'Условия' },
    { command: 'paysupport', description: 'Вопросы по оплате' },
  ] });
  res.description = await tg(env, 'setMyDescription', { description: 'Подписка «Ханами» для сайта «Твой личный путеводитель в японский язык». Все фоны сайта и значок 花見. Обучение на сайте бесплатное для всех.' });
  res.short = await tg(env, 'setMyShortDescription', { short_description: 'Подписка «Ханами» для «Путеводителя в японский» 🌸' });
  return res;
}

async function handleUpdate(u, env) {
  if (u.pre_checkout_query) return preCheckout(u.pre_checkout_query, env);
  const m = u.message;
  if (!m) return;
  if (m.successful_payment) return paid(m, env);
  if (!m.text || m.chat.type !== 'private') return;
  const [cmdRaw, ...args] = m.text.trim().split(/\s+/);
  const cmd = cmdRaw.split('@')[0].toLowerCase();
  const isAdmin = String(m.from.id) === String(env.ADMIN_TG_ID || '');
  if (cmd === '/start') return start(m, env);
  if (cmd === '/status') return status(m, env);
  if (cmd === '/code') return resend(m, env);
  if (cmd === '/cancel') return cancel(m, env);
  if (cmd === '/terms') return terms(m, env);
  if (cmd === '/paysupport' || cmd === '/support') return support(m, env);
  if (cmd === '/refund' && isAdmin) return refund(m, args, env);
  if (cmd === '/id') return send(env, m.chat.id, `Ваш Telegram ID: <code>${m.from.id}</code>`);
  return send(env, m.chat.id, 'Я понимаю команды /start, /status, /code, /cancel, /terms и /paysupport.');
}

// ===================== Сценарии =====================
async function start(m, env) {
  const link = await tg(env, 'createInvoiceLink', {
    title: 'Ханами 花見 — 30 дней',
    description: 'Все фоны сайта «Путеводитель в японский» и значок 花見. Продлевается автоматически каждые 30 дней, отключить можно в любой момент.',
    payload: 'hanami:' + m.from.id,
    currency: 'XTR',
    prices: [{ label: 'Ханами на 30 дней', amount: price(env) }],
    subscription_period: PERIOD,
  });
  const text = [
    'Привет! Это бот сайта <b>«Твой личный путеводитель в японский язык»</b> 🌸',
    '',
    `Подписка <b>«Ханами» 花見</b> — <b>${price(env)} ⭐ в месяц</b>. Это способ поддержать проект и получить красивые бонусы:`,
    '• все фоны сайта: Ночной Токио, Рисовые поля, Осенние клёны, Зимние ворота — в светлой и тёмной теме;',
    '• значок 花見 в шапке сайта.',
    '',
    'Всё обучение на сайте остаётся бесплатным для всех.',
    '',
    'После оплаты я сразу пришлю код на 30 дней. Подписка продлевается автоматически, и с каждым продлением приходит новый код. Отключить автопродление — команда /cancel.',
  ].join('\n');
  return send(env, m.chat.id, text, { reply_markup: { inline_keyboard: [
    [{ text: `Оформить за ${price(env)} ⭐`, url: link }],
    [{ text: 'Открыть сайт', url: site(env) }],
  ] } });
}

async function preCheckout(q, env) {
  const okPayload = typeof q.invoice_payload === 'string' && q.invoice_payload.startsWith('hanami:');
  const ok = okPayload && q.currency === 'XTR' && q.total_amount === price(env);
  return tg(env, 'answerPreCheckoutQuery', ok
    ? { pre_checkout_query_id: q.id, ok: true }
    : { pre_checkout_query_id: q.id, ok: false, error_message: 'Цена подписки изменилась. Нажмите /start, чтобы получить новую кнопку оплаты.' });
}

async function paid(m, env) {
  const sp = m.successful_payment;
  if (sp.currency !== 'XTR') return;
  const chargeId = sp.telegram_payment_charge_id;
  const uid = String(m.from.id);
  const who = m.from.username ? '@' + m.from.username : [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') || uid;
  const expires = sp.subscription_expiration_date ? new Date(sp.subscription_expiration_date * 1000) : new Date(Date.now() + PERIOD * 1000);

  // Платёж уже обработан (Telegram повторил запрос) — просто напомним код.
  const existing = await fsGet(env, 'payments/' + chargeId);
  if (existing) {
    return send(env, m.chat.id, `Этот платёж уже обработан. Ваш код: <code>${esc(existing.code)}</code>`);
  }

  const now = new Date();
  let code = '', done = false;
  for (let i = 0; i < 5 && !done; i++) {
    code = newCode();
    try {
      await fsCommit(env, [
        fsCreate(env, 'codes/' + code, { used: false, issued: true, note: who + ' · Stars', source: 'telegram', tgId: uid, chargeId, createdAt: now, issuedAt: now }),
        fsCreate(env, 'payments/' + chargeId, { code, tgId: uid, who, stars: sp.total_amount, recurring: !!sp.is_recurring, createdAt: now }),
        fsSet(env, 'tg/' + uid, { lastCode: code, chargeId, who, expires, updatedAt: now, canceled: false }),
      ]);
      done = true;
    } catch (e) {
      if (/ALREADY_EXISTS|409/.test(String(e.message))) {
        if (await fsGet(env, 'payments/' + chargeId)) return; // параллельный повтор того же платежа
        continue; // совпал код — пробуем другой
      }
      throw e;
    }
  }
  if (!done) throw new Error('Не удалось создать уникальный код');

  const renewal = sp.is_recurring && !sp.is_first_recurring;
  const text = [
    renewal ? 'Подписка «Ханами» продлена ✨ Спасибо, что вы с нами!' : 'Спасибо за поддержку! 🌸 Подписка «Ханами» оформлена.',
    '',
    `Ваш код на 30 дней: <code>${code}</code>`,
    '(нажмите на код, чтобы скопировать)',
    '',
    'Как активировать:',
    `1. Откройте сайт: ${site(env)}`,
    '2. Войдите в аккаунт (кнопка «Войти» в шапке).',
    '3. Откройте раздел «Поддержать» и введите код.',
    '',
    `Следующее продление — ${fmtDate(expires)}. Тогда придёт новый код, и оставшиеся дни не сгорят.`,
  ].join('\n');
  await send(env, m.chat.id, text, { reply_markup: { inline_keyboard: [[{ text: 'Открыть сайт', url: site(env) }]] } });
  if (env.ADMIN_TG_ID && String(env.ADMIN_TG_ID) !== uid) {
    await send(env, env.ADMIN_TG_ID, `${renewal ? '🔁 Продление' : '⭐ Новая подписка'}: ${esc(who)} (ID <code>${uid}</code>), ${sp.total_amount} ⭐\nКод: <code>${code}</code>\nПлатёж: <code>${esc(chargeId)}</code>`).catch(() => {});
  }
}

async function status(m, env) {
  const t = await fsGet(env, 'tg/' + m.from.id);
  if (!t) return send(env, m.chat.id, 'У вас пока нет подписки «Ханами». Оформить — /start');
  const c = t.lastCode ? await fsGet(env, 'codes/' + t.lastCode) : null;
  const active = t.expires && new Date(t.expires) > new Date();
  const lines = [
    active ? `Подписка «Ханами» оплачена до <b>${fmtDate(new Date(t.expires))}</b>.` : 'Срок последней оплаты закончился.',
    t.canceled ? 'Автопродление отключено.' : (active ? 'Автопродление включено.' : ''),
    t.lastCode ? `Последний код: <code>${esc(t.lastCode)}</code> — ${c && c.used ? 'уже активирован на сайте ✅' : 'ещё не введён на сайте'}.` : '',
  ].filter(Boolean);
  if (!active) lines.push('Оформить снова — /start');
  return send(env, m.chat.id, lines.join('\n'));
}

async function resend(m, env) {
  const t = await fsGet(env, 'tg/' + m.from.id);
  if (!t || !t.lastCode) return send(env, m.chat.id, 'Кодов пока нет. Оформить «Ханами» — /start');
  return send(env, m.chat.id, `Ваш последний код: <code>${esc(t.lastCode)}</code>\nВведите его на сайте в разделе «Поддержать».`);
}

async function cancel(m, env) {
  const t = await fsGet(env, 'tg/' + m.from.id);
  if (!t || !t.chargeId) return send(env, m.chat.id, 'Активной подписки не нашлось.');
  if (t.canceled) return send(env, m.chat.id, 'Автопродление уже отключено.');
  await tg(env, 'editUserStarSubscription', { user_id: m.from.id, telegram_payment_charge_id: t.chargeId, is_canceled: true });
  await fsCommit(env, [fsSet(env, 'tg/' + m.from.id, { ...t, expires: new Date(t.expires), updatedAt: new Date(t.updatedAt || Date.now()), canceled: true })]);
  return send(env, m.chat.id, `Автопродление отключено. Уже выданный код действует как обычно${t.expires ? `, оплаченный период — до ${fmtDate(new Date(t.expires))}` : ''}. Вернуться можно в любой момент: /start`);
}

function terms(m, env) {
  return send(env, m.chat.id, [
    '<b>Условия подписки «Ханами»</b>',
    '',
    '• Подписка — добровольная поддержка проекта. Она даёт только оформление сайта: платные фоны и значок. Обучение бесплатно для всех и не зависит от подписки.',
    '• Оплата — в Telegram Stars, раз в 30 дней, автоматически. Отключить автопродление можно командой /cancel или в настройках Telegram.',
    '• После каждой оплаты бот присылает код на 30 дней. Код одноразовый и вводится на сайте в аккаунте.',
    '• Возврат возможен, если код из этой оплаты ещё не активирован на сайте. Напишите в /paysupport.',
    `• Сайт: ${site(env)}`,
  ].join('\n'));
}

function support(m, env) {
  const contact = env.SUPPORT_CONTACT || '@legendmifs';
  return send(env, m.chat.id, `По вопросам оплаты и возвратов пишите: ${esc(contact)}\nУкажите ваш Telegram ID: <code>${m.from.id}</code> — его можно получить и командой /id.`);
}

// /refund <user_id> — вернуть последний платёж пользователя (только для админа)
async function refund(m, args, env) {
  const uid = (args[0] || '').trim();
  if (!/^\d+$/.test(uid)) return send(env, m.chat.id, 'Формат: /refund <user_id> [charge_id]');
  const t = await fsGet(env, 'tg/' + uid);
  const chargeId = args[1] || (t && t.chargeId);
  if (!chargeId) return send(env, m.chat.id, 'Платёж не найден.');
  const pay = await fsGet(env, 'payments/' + chargeId);
  if (pay && pay.code) {
    const c = await fsGet(env, 'codes/' + pay.code);
    if (c && c.used && c.usedBy !== 'refunded') return send(env, m.chat.id, `Код ${esc(pay.code)} уже активирован на сайте. Если всё равно нужен возврат, сначала уменьши срок в базе вручную.`);
  }
  await tg(env, 'refundStarPayment', { user_id: Number(uid), telegram_payment_charge_id: chargeId });
  const writes = [];
  if (pay && pay.code) writes.push({ update: { name: docName(env, 'codes/' + pay.code), fields: toFields({ used: true, usedBy: 'refunded' }) }, updateMask: { fieldPaths: ['used', 'usedBy'] } });
  if (t) writes.push(fsSet(env, 'tg/' + uid, { ...t, expires: new Date(), updatedAt: new Date(), canceled: true }));
  if (writes.length) await fsCommit(env, writes);
  await send(env, uid, 'Возврат звёзд оформлен. Код из этой оплаты больше не действует.').catch(() => {});
  return send(env, m.chat.id, `Готово: звёзды возвращены, код ${pay && pay.code ? esc(pay.code) + ' ' : ''}отключён.`);
}

// ===================== Коды и даты =====================
function newCode() {
  const r = new Uint32Array(8); crypto.getRandomValues(r);
  const s = Array.from(r, v => ALPH[v % ALPH.length]).join('');
  return `HANAMI-${s.slice(0, 4)}-${s.slice(4)}`;
}
function fmtDate(d) {
  const msk = new Date(d.getTime() + 3 * 3600 * 1000); // Москва, UTC+3
  return `${msk.getUTCDate()} ${MONTHS[msk.getUTCMonth()]} ${msk.getUTCFullYear()}`;
}
const json = o => new Response(JSON.stringify(o, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } });

// ===================== Firestore (REST + сервисный аккаунт) =====================
let tokenCache = null;
function sa(env) { return typeof env.FIREBASE_SA === 'string' ? JSON.parse(env.FIREBASE_SA) : env.FIREBASE_SA; }
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = str => b64url(new TextEncoder().encode(str));

async function accessToken(env) {
  if (tokenCache && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const acc = sa(env), now = Math.floor(Date.now() / 1000);
  const head = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlStr(JSON.stringify({ iss: acc.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = acc.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claim));
  const jwt = head + '.' + claim + '.' + b64url(sig);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt,
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Google OAuth: ' + JSON.stringify(d));
  tokenCache = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return tokenCache.token;
}
const docName = (env, path) => `projects/${sa(env).project_id}/databases/(default)/documents/${path}`;
const fsBase = env => `https://firestore.googleapis.com/v1/projects/${sa(env).project_id}/databases/(default)/documents`;

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
const toFields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));
function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  return null;
}
const fsCreate = (env, path, data) => ({ update: { name: docName(env, path), fields: toFields(data) }, currentDocument: { exists: false } });
const fsSet = (env, path, data) => ({ update: { name: docName(env, path), fields: toFields(data) } });

async function fsGet(env, path) {
  const r = await fetch(`${fsBase(env)}/${path}`, { headers: { authorization: 'Bearer ' + await accessToken(env) } });
  if (r.status === 404) return null;
  const d = await r.json();
  if (!r.ok) throw new Error('Firestore get: ' + JSON.stringify(d));
  return Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fromValue(v)]));
}
async function fsCommit(env, writes) {
  const r = await fetch(`${fsBase(env)}:commit`, {
    method: 'POST', headers: { authorization: 'Bearer ' + await accessToken(env), 'content-type': 'application/json' },
    body: JSON.stringify({ writes }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`Firestore commit ${r.status}: ${(d.error && (d.error.status + ' ' + d.error.message)) || JSON.stringify(d)}`);
  return d;
}

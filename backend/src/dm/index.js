const store = require('./store');
const agent = require('./agent');
const receipt = require('./receipt');
const texts = require('./texts');
const spam = require('../spam');

// ИИ-продавец рекламы в директе Threads.
//
// Рекламу Шабашке заказывают в Threads, и почти всегда одним и тем же
// разговором: «сколько стоит?» → «50 сом» → «куда платить?» → номер МБанка →
// скриншот чека → публикация. Второй частый разговор — человек принял Шабашку
// за работодателя и спрашивает про вакансию из поста. Оба бот теперь ведёт сам.
//
// API для директа у Meta нет — ни чтения, ни отправки (сентябрь 2026). Поэтому
// директ читает и пишет расширение в Chrome владельца, где Threads и так открыт
// под его логином (см. tools/threads-dm), а думает и решает сервер: расширение
// присылает сюда новые сообщения переписки и отправляет то, что ответили.
//
// Бот отвечает только в запросах на переписку — то есть незнакомым людям — и в
// разговорах, которые начал сам. Личную переписку владельца он не трогает, а
// если владелец сам вмешался в разговор, замолкает в нём на полсуток.

const CHANNEL = 'threads';
const HOUR_MS = 60 * 60 * 1000;
// Владелец написал в разговор сам — бот ему не мешает.
const OWNER_PAUSE_MS = 12 * HOUR_MS;
// Позвали человека — бот молчит, пока админ разбирается.
const HANDOFF_PAUSE_MS = 12 * HOUR_MS;
// Картинка больше этого — не скриншот чека и не фото для рекламы.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Расширение молчит дольше — значит, Chrome закрыт или Threads разлогинил.
const BRIDGE_SILENCE_MS = 30 * 60 * 1000;

let hooks = {
  // Выложить рекламу: { chat, text, image } → { threads, siteLink, refused }.
  publish: async () => ({ threads: false }),
  // Сказать админу: { type, chat, ... } — как именно, решает бот.
  admin: async () => {},
};

// Разговоры с одним человеком — строго по очереди: расширение может прислать
// тот же разговор повторно, пока модель ещё думает над первым, и тогда он
// получил бы два ответа.
const locks = new Map();
function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  next
    .finally(() => {
      if (locks.get(key) === next) locks.delete(key);
    })
    .catch(() => {});
  return next;
}

// Правка разговора не из sync (решение админа по чеку, вышедший пост, отчёт) —
// под тем же замком: store.save пишет все поля разом, и без замка сохранение
// sync, начатое минутой раньше, вернуло бы старую стадию и историю. А потеряй
// история ссылку на пост — бот принял бы собственное сообщение за слова
// владельца и замолчал на полсуток. fn получает свежую копию или null.
async function update(chatId, fn) {
  const chat = await store.byId(chatId);
  if (!chat) return fn(null);
  return withLock(chat.peer, async () => fn(await store.byId(chatId)));
}

// Сравниваем только буквы и цифры: эмодзи Threads может нарисовать картинкой,
// ссылку — переписать, переводы строк — склеить, и «Оплату вижу ✅» на
// странице читается как «Оплату вижу». Без этого бот принял бы собственный
// ответ за слова владельца и замолчал.
const norm = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

// Своё ли это сообщение. В переписке «от меня» — и ответы бота, и то, что
// владелец написал руками; различаем по тексту: всё, что писал бот, лежит в
// истории.
function isBotText(text, botTexts) {
  const n = norm(text);
  if (!n) return false;
  return botTexts.some((b) => b === n || (n.length >= 20 && b.length >= 20 && b.slice(0, 20) === n.slice(0, 20)));
}

function toBuffer(image) {
  if (!image || typeof image !== 'string') return null;
  const base64 = image.includes(',') ? image.slice(image.indexOf(',') + 1) : image;
  const buffer = Buffer.from(base64, 'base64');
  return buffer.length && buffer.length <= MAX_IMAGE_BYTES ? buffer : null;
}

const paused = (chat, now = Date.now()) => chat.paused_until && new Date(chat.paused_until).getTime() > now;

function remember(chat, from, text, extra = {}) {
  chat.history = [...(chat.history || []), { from, text: String(text || '').slice(0, 2000), at: Date.now(), ...extra }];
}

// Сообщение не в ответ, а само: ссылка на пост, отчёт, решение по чеку.
async function tell(chat, key, vars) {
  const text = texts.render(key, chat.lang || 'ru', vars);
  remember(chat, 'bot', text);
  await store.queue(chat.id, text);
  return text;
}

const notifyAdmin = (event) =>
  Promise.resolve()
    .then(() => hooks.admin(event))
    .catch((err) => console.error(`[директ] админу не ушло (${event.type}):`, err.message));

// Выкладываем рекламу. Долго — минута и больше, — поэтому своим ходом: ответ
// «публикую» человек получает сразу, а ссылку — когда пост выйдет (onPosted).
async function startPublish(chatId) {
  const chat = await store.byId(chatId);
  if (!chat) return;
  try {
    const result = (await hooks.publish({ chat, text: chat.ad_text || '', image: chat.ad_image || null })) || {};
    if (result.refused) {
      await update(chatId, async (fresh) => {
        if (!fresh) return;
        fresh.stage = 'declined';
        await tell(fresh, 'forbidden');
        await store.save(fresh);
        notifyAdmin({ type: 'refused', chat: fresh, reason: result.refused });
      });
      return;
    }
    // Threads не настроен — поста, а с ним и ссылки на него, не будет. Отдаём
    // ссылку на сайт, чтобы человек не ждал зря.
    if (!result.threads && result.siteLink) await finish(chatId, result.siteLink, null);
  } catch (err) {
    console.error('[директ] реклама не вышла:', err);
    await update(chatId, async (fresh) => {
      if (!fresh) return;
      await tell(fresh, 'publishFailed');
      await store.save(fresh);
      notifyAdmin({ type: 'publishFailed', chat: fresh, error: err.message });
    });
  }
}

// Реклама вышла — ссылка человеку.
async function finish(chatId, link, campaignId) {
  await update(chatId, async (chat) => {
    if (!chat) return;
    if (campaignId) chat.campaign_id = campaignId;
    // Повтор поста (кнопка «поднять») второй раз ссылку не шлёт.
    if (chat.stage !== 'published') {
      chat.stage = 'published';
      await tell(chat, 'published', { link });
    }
    await store.save(chat);
  });
}

// Разобрать картинки: чек это или фото для рекламы. Смотрим максимум две и
// останавливаемся на первом чеке — один чек за раз.
async function readImages(chat, buffers) {
  const found = { receipt: null, photo: null };
  for (const buffer of buffers) {
    let check = null;
    try {
      check = await receipt.inspect(buffer);
    } catch (err) {
      console.error(`[директ] картинку не прочитать (${err.message})`);
    }
    if (check && check.kind === 'receipt') {
      const keys = receipt.keysOf(buffer, check);
      const duplicate = await store.receiptSeen(keys);
      found.receipt = { buffer, check, keys, verdict: receipt.verify(check, { duplicate }) };
      return found;
    }
    // Модель картинку не посмотрела (лимиты, сбой). На стадии оплаты это почти
    // наверняка чек — отдаём его админу, а не теряем.
    if (!check && ['offered', 'awaiting_payment'].includes(chat.stage)) {
      found.receipt = { buffer, check: null, keys: receipt.keysOf(buffer, null), verdict: null };
      return found;
    }
    found.photo = buffer;
  }
  return found;
}

async function handle(chat, fresh) {
  const incoming = fresh.filter((m) => m.from !== 'me');
  const text = incoming
    .map((m) => String(m.text || '').trim())
    .filter(Boolean)
    .join('\n');
  const buffers = incoming.map((m) => toBuffer(m.image)).filter(Boolean).slice(-2);

  const intent = text ? await agent.classify({ history: chat.history, stage: chat.stage, text }) : null;
  for (const m of incoming) remember(chat, 'them', m.text, m.image || m.hasImage ? { image: true } : {});
  if (!intent && !buffers.length) {
    await store.save(chat);
    return [];
  }
  if (intent) chat.lang = intent.lang;
  else if (text) chat.lang = agent.guessLang(text);

  const images = buffers.length && chat.stage !== 'publishing' ? await readImages(chat, buffers) : {};
  const shot = images.receipt;
  const ev = {
    intent: intent && intent.intent,
    adText: intent ? intent.adText : '',
    // Сетевой найм и оформление на чужие документы ловим и словами (см.
    // spam.js): модель их пропускает. Решает всё равно decide — запрет у него
    // срабатывает, только когда речь о самой рекламе.
    forbidden: Boolean(intent && intent.forbidden) || Boolean(spam.check([intent ? intent.adText : '', text].join('\n'))),
    answer: intent ? intent.answer : '',
    photo: Boolean(images.photo),
    receipt: shot
      ? shot.verdict
        ? { ok: shot.verdict.ok, reason: shot.verdict.reason }
        : { review: true }
      : null,
  };

  const decision = agent.decide(
    {
      stage: chat.stage,
      hasText: Boolean(chat.ad_text),
      hasImage: Boolean(chat.ad_image),
      fails: chat.receipt_fails || 0,
      mbank: Boolean(texts.mbank().number),
    },
    ev
  );
  const has = (name) => decision.actions.includes(name);

  if (has('reset')) {
    chat.ad_text = null;
    chat.ad_image = null;
    chat.payment = null;
    chat.campaign_id = null;
  }
  if (ev.adText && !has('forbidden')) chat.ad_text = ev.adText;
  if (images.photo && !has('forbidden')) chat.ad_image = images.photo;
  if (shot && (has('paid') || has('review'))) {
    chat.payment = {
      status: has('paid') ? 'ok' : 'review',
      check: shot.check,
      warnings: shot.verdict ? shot.verdict.warnings : ['модель чек не прочитала'],
      reason: shot.verdict ? shot.verdict.reason : '',
      keys: shot.keys,
      at: Date.now(),
    };
  }
  chat.stage = decision.stage;
  chat.receipt_fails = decision.fails;
  if (has('handoff')) chat.paused_until = new Date(Date.now() + HANDOFF_PAUSE_MS);

  const replies = decision.say.map(({ key, vars }) => texts.render(key, chat.lang || 'ru', vars));
  for (const reply of replies) remember(chat, 'bot', reply);
  if (has('paid')) await store.rememberReceipt(shot.keys, chat.id);
  await store.save(chat);

  // Админу — после записи: в сообщении у него кнопки, и нажатие должно найти
  // разговор уже в новой стадии.
  if (has('paid')) notifyAdmin({ type: 'paid', chat, check: shot.check, warnings: chat.payment.warnings, image: shot.buffer });
  if (has('review')) {
    notifyAdmin({ type: 'review', chat, check: shot.check, reason: chat.payment.reason, image: shot.buffer });
  }
  if (has('handoff')) notifyAdmin({ type: 'handoff', chat, text });
  if (has('noMbank')) notifyAdmin({ type: 'noMbank', chat });
  if (has('forbidden')) notifyAdmin({ type: 'forbidden', chat, text: ev.adText || text });
  if (has('publish')) startPublish(chat.id).catch((err) => console.error('[директ] публикация:', err));

  return replies;
}

let lastSync = 0;
let silentNotified = false;

// Расширение прислало разговор. peer — имя пользователя в Threads, request —
// разговор из папки запросов (незнакомый человек). messages — последние
// сообщения разговора: { key, from: 'them' | 'me', text, image?, hasImage? }.
// Возвращает ответы, которые расширение отправит в этот разговор.
async function sync({ peer, name = '', request = false, messages = [] }) {
  const who = String(peer || '').replace(/^@/, '').trim().toLowerCase();
  if (!who) throw new Error('не указан собеседник');
  touch();
  return withLock(who, async () => {
    let chat = await store.get(CHANNEL, who);
    // Не запрос и не наш разговор — это личная переписка владельца.
    if (!chat && !request) return { replies: [], ignored: true };
    if (!chat) chat = await store.create(CHANNEL, who, name);
    if (name && !chat.peer_name) chat.peer_name = name;

    const list = (Array.isArray(messages) ? messages : []).filter((m) => m && m.key);
    const seen = new Set(chat.seen || []);
    const fresh = list.filter((m) => !seen.has(String(m.key)));
    if (!fresh.length) return { replies: [] };
    chat.seen = [...(chat.seen || []), ...fresh.map((m) => String(m.key))];

    // Своё «от меня», которого нет в истории бота, — владелец пишет сам.
    const botTexts = (chat.history || []).filter((h) => h.from === 'bot').map((h) => norm(h.text));
    const owner = fresh.filter((m) => m.from === 'me' && (m.image || m.hasImage || !isBotText(m.text, botTexts)));
    for (const m of owner) remember(chat, 'owner', m.text);
    if (owner.length) chat.paused_until = new Date(Date.now() + OWNER_PAUSE_MS);

    // Отвечаем только на то, что пришло после последнего нашего сообщения:
    // на уже отвеченное второй раз не отвечают.
    let lastMine = -1;
    fresh.forEach((m, i) => {
      if (m.from === 'me') lastMine = i;
    });
    const pending = fresh.slice(lastMine + 1).filter((m) => m.from !== 'me');
    const answered = fresh.slice(0, lastMine + 1).filter((m) => m.from !== 'me');
    for (const m of answered) remember(chat, 'them', m.text, m.image || m.hasImage ? { image: true } : {});

    if (!pending.length || paused(chat)) {
      for (const m of pending) remember(chat, 'them', m.text, m.image || m.hasImage ? { image: true } : {});
      await store.save(chat);
      return { replies: [], paused: Boolean(paused(chat)) };
    }
    const replies = await handle(chat, pending);
    return { replies };
  });
}

// Расширение живо — и если молчало, сказать админу, что снова на связи.
function touch() {
  const wasSilent = silentNotified;
  lastSync = Date.now();
  if (wasSilent) {
    silentNotified = false;
    notifyAdmin({ type: 'bridgeUp' });
  }
}

async function outbox() {
  touch();
  return store.outbox(CHANNEL);
}

// Ответ ушёл в историю, а из браузера не отправился (не принялся запрос, не
// нашлось поле ввода). Кладём его в очередь исходящих: расширение повторит.
async function requeue(peer, list) {
  const who = String(peer || '').replace(/^@/, '').trim().toLowerCase();
  const chat = who ? await store.get(CHANNEL, who) : null;
  if (!chat) return 0;
  const clean = (Array.isArray(list) ? list : []).map((t) => String(t || '').trim()).filter(Boolean).slice(0, 5);
  for (const text of clean) await store.queue(chat.id, text);
  return clean.length;
}

async function peers() {
  touch();
  return store.peers(CHANNEL);
}

// Админ посмотрел чек (кнопки под копией чека в Telegram).
async function approve(chatId) {
  return update(chatId, (chat) => approveChat(chat));
}

async function approveChat(chat) {
  if (!chat) return 'нет такого разговора';
  if (!['checking', 'awaiting_payment', 'offered', 'new'].includes(chat.stage)) return `разговор уже на стадии ${chat.stage}`;
  if (chat.payment) {
    chat.payment.status = 'ok';
    if (chat.payment.keys) await store.rememberReceipt(chat.payment.keys, chat.id);
  }
  chat.receipt_fails = 0;
  chat.paused_until = null;
  const ready = Boolean(chat.ad_text || chat.ad_image);
  chat.stage = ready ? 'publishing' : 'awaiting_text';
  await tell(chat, ready ? 'paidPublishing' : 'paidNeedText');
  await store.save(chat);
  if (ready) startPublish(chat.id).catch((err) => console.error('[директ] публикация:', err));
  return ready ? 'публикую' : 'жду текст объявления';
}

async function reject(chatId) {
  return update(chatId, async (chat) => {
    if (!chat) return 'нет такого разговора';
    chat.stage = 'awaiting_payment';
    chat.receipt_fails = 0;
    chat.payment = null;
    chat.paused_until = null;
    await tell(chat, 'receiptRejected');
    await store.save(chat);
    return 'сказал, что оплаты нет';
  });
}

async function pause(chatId, hours = 24) {
  return update(chatId, async (chat) => {
    if (!chat) return false;
    chat.paused_until = new Date(Date.now() + hours * HOUR_MS);
    await store.save(chat);
    return true;
  });
}

async function resume(chatId) {
  return update(chatId, async (chat) => {
    if (!chat) return false;
    chat.paused_until = null;
    await store.save(chat);
    return true;
  });
}

// Пост рекламы вышел в Threads (см. onThreads в bot.js).
async function onPosted(chatId, link, campaignId) {
  await finish(chatId, link, campaignId);
}

// Суточный отчёт. Человеку — только когда гарантия выполнена: недобор решает
// админ (поднять рекламу или договориться), а бот за него не обещает.
// Возвращает 'sent' — отчёт ушёл человеку, 'short' — реклама из директа, но
// недобор, null — реклама не из директа.
async function onReport(campaignId, totals, goal) {
  const found = await store.byCampaign(campaignId);
  if (!found) return null;
  if (totals.views < goal) return 'short';
  return update(found.id, async (chat) => {
    if (!chat) return null;
    await tell(chat, 'report', totals);
    await store.save(chat);
    return 'sent';
  });
}

async function status() {
  return { lastSync, chats: await store.recent(10) };
}

let timer = null;

function start(given) {
  hooks = { ...hooks, ...given };
  if (timer) return;
  timer = setInterval(() => {
    if (lastSync && !silentNotified && Date.now() - lastSync > BRIDGE_SILENCE_MS) {
      silentNotified = true;
      notifyAdmin({ type: 'bridgeDown', since: lastSync });
    }
  }, 5 * 60 * 1000);
  timer.unref();
}

module.exports = {
  sync,
  outbox,
  sent: (id) => store.sent(id),
  requeue,
  peers,
  approve,
  reject,
  pause,
  resume,
  onPosted,
  onReport,
  status,
  start,
  isBotText,
  CHANNEL,
  OWNER_PAUSE_MS,
};

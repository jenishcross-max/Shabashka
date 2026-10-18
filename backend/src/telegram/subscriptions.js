// Подписка на новые вакансии по профессии (исследование 18 октября 2026, см.
// docs/research/2026-10-18-marketing-research.md): человек нашёл одну вакансию,
// позвонил и ушёл — повода вернуться у него не было. Теперь бот раз в час
// присылает свежие вакансии по профессиям, которые человек отметил.
//
// Это публичная часть админского бота: подписаться может кто угодно — по
// ссылке с посадочной страницы (/start sub_<slug>, см. routes/subscribe.js) или
// просто написав боту /start. Админские команды по-прежнему только для админов
// (см. onMessage в bot.js).
//
// Профессии — посадочные страницы с категорией (см. landings.js): у каждой
// есть страница, на которую ведёт «ещё N» в рассылке.
const db = require('../db');
const landings = require('../landings');
const { money } = require('../money');
const { esc } = require('./api');

const PROFESSIONS = landings.filter((l) => l.category);
const bySlug = (slug) => PROFESSIONS.find((p) => p.slug === slug) || null;
const byCategory = (category) => PROFESSIONS.find((p) => p.category === category) || null;

// Шлём днём: с 9:00 до 21:59 по Бишкеку (UTC+6). Ночные вакансии придут
// утренней подборкой — курсор помнит, докуда дошли.
const HOUR_FROM = 9;
const HOUR_TO = 21;
const BISHKEK_OFFSET_H = 6;
const PER_CATEGORY = 5;
const CURSOR_KEY = 'subs:last_vacancy_id';
const EVERY_MS = 60 * 60 * 1000;
// Telegram пускает около 30 сообщений в секунду на бота — держимся ниже.
const PAUSE_MS = 50;

const subscribe = (chatId, category) =>
  db.query('INSERT INTO subscriptions (chat_id, category) VALUES ($1, $2) ON CONFLICT DO NOTHING', [chatId, category]);
const unsubscribe = (chatId, category) =>
  db.query('DELETE FROM subscriptions WHERE chat_id = $1 AND category = $2', [chatId, category]);
const unsubscribeAll = (chatId) => db.query('DELETE FROM subscriptions WHERE chat_id = $1', [chatId]);

async function categoriesOf(chatId) {
  const { rows } = await db.query('SELECT category FROM subscriptions WHERE chat_id = $1 ORDER BY created_at, category', [
    chatId,
  ]);
  return rows.map((r) => r.category);
}

function keyboard(chosen) {
  const set = new Set(chosen);
  const buttons = PROFESSIONS.map((p) => ({
    text: `${set.has(p.category) ? '✅ ' : ''}${p.category}`,
    callback_data: `sub:${p.slug}`,
  }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  if (set.size) rows.push([{ text: '🔕 Отписаться от всех', callback_data: 'sub:off' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

function menuText(chosen, lead = '') {
  return [
    ...(lead ? [lead, ''] : []),
    '🔔 Новые вакансии Шабашки — прямо сюда.',
    `Отметьте профессии: раз в час, с ${HOUR_FROM}:00 до ${HOUR_TO}:00, пришлю свежие вакансии по ним. Одно сообщение и только когда есть новое.`,
    '',
    chosen.length ? `Сейчас: ${chosen.join(', ')}` : 'Сейчас подписок нет.',
  ].join('\n');
}

async function showMenu(chatId, { send }, lead = '') {
  const chosen = await categoriesOf(chatId);
  await send(chatId, esc(menuText(chosen, lead)), keyboard(chosen));
}

// Сообщение в личке. true — наше, дальше не разбирать. admin — у админа
// /start показывает его справку, поэтому ему здесь только подписка по ссылке.
async function onMessage(message, deps, { admin = false } = {}) {
  if (!message || message.chat.type !== 'private') return false;
  const chatId = message.chat.id;
  const text = String(message.text || '').trim();

  const link = text.match(/^\/start\s+sub_([\w-]+)$/);
  if (link) {
    const profession = bySlug(link[1]);
    if (profession) await subscribe(chatId, profession.category);
    await showMenu(chatId, deps, profession ? `✅ Подписал: ${profession.category}` : '');
    return true;
  }
  if (text === '/subs' || (!admin && text === '/start')) {
    await showMenu(chatId, deps);
    return true;
  }
  if (text === '/stop') {
    await unsubscribeAll(chatId);
    await deps.send(chatId, 'Отписал от всех вакансий. Вернуться — /start.');
    return true;
  }
  return false;
}

// Кнопка под меню. true — наша.
async function onCallback(query, { answer, edit }) {
  const data = String(query.data || '');
  if (!data.startsWith('sub:')) return false;
  const chatId = query.message.chat.id;
  const slug = data.slice(4);

  let note = '';
  if (slug === 'off') {
    await unsubscribeAll(chatId);
    note = 'Отписал от всех';
  } else {
    const profession = bySlug(slug);
    if (!profession) {
      await answer(query.id, 'Такой профессии уже нет');
      return true;
    }
    const chosen = await categoriesOf(chatId);
    if (chosen.includes(profession.category)) {
      await unsubscribe(chatId, profession.category);
      note = `Отписал: ${profession.category}`;
    } else {
      await subscribe(chatId, profession.category);
      note = `Подписал: ${profession.category}`;
    }
  }
  await answer(query.id, note);
  const chosen = await categoriesOf(chatId);
  await edit(chatId, query.message.message_id, keyboard(chosen));
  return true;
}

const bishkekHour = (now) => (now.getUTCHours() + BISHKEK_OFFSET_H) % 24;

async function readCursor() {
  const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [CURSOR_KEY]);
  return rows[0] ? Number(rows[0].value) : null;
}
const writeCursor = (id) =>
  db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [CURSOR_KEY, String(id)]
  );

function vacancyLine(v, { siteUrl, pretty }) {
  const pay = v.salary_min ? `, от ${money(v.salary_min)} сом` : '';
  return `• ${esc(v.title)} — ${esc(v.city)}${pay}\n${esc(pretty(`${siteUrl}/vacancies/${v.id}`))}`;
}

function digestText(sections, deps) {
  const parts = ['🔔 <b>Новые вакансии</b>'];
  for (const { category, items } of sections) {
    const shown = items.slice(0, PER_CATEGORY);
    const lines = [`<b>${esc(category)}</b>`, ...shown.map((v) => vacancyLine(v, deps))];
    const rest = items.length - shown.length;
    const page = byCategory(category);
    if (rest > 0 && page) lines.push(`Ещё ${rest} — ${esc(deps.pretty(`${deps.siteUrl}/rabota/${page.slug}`))}`);
    parts.push(lines.join('\n'));
  }
  parts.push('Настроить профессии — /subs, отписаться — /stop');
  return parts.join('\n\n');
}

// Один проход рассылки. null — не время (ночь); иначе { sent, removed }.
// Каждому подписчику — одно сообщение по всем его профессиям, свежие вакансии
// первыми. Заблокировал бота — подписку убираем: слать ему больше некуда.
async function digest({ now = new Date(), pause = (ms) => new Promise((r) => setTimeout(r, ms)), ...deps }) {
  const hour = bishkekHour(now);
  if (hour < HOUR_FROM || hour > HOUR_TO) return null;

  const { rows: top } = await db.query('SELECT COALESCE(MAX(id), 0)::int AS id FROM vacancies');
  const maxId = top[0].id;
  const cursor = await readCursor();
  // Первый запуск только запоминает, докуда дошли: прошлые вакансии не шлём.
  if (cursor === null) {
    await writeCursor(maxId);
    return { sent: 0, removed: 0 };
  }

  const { rows: subscriptions } = await db.query('SELECT chat_id, category FROM subscriptions');
  const categories = [...new Set(subscriptions.map((s) => s.category))];
  const fresh = new Map();
  if (categories.length) {
    const { rows } = await db.query(
      `SELECT id, title, city, salary_min, category FROM vacancies
        WHERE id > $1 AND id <= $2 AND status = 'open' AND category = ANY($3::text[])
        ORDER BY id DESC`,
      [cursor, maxId, categories]
    );
    for (const v of rows) fresh.set(v.category, [...(fresh.get(v.category) || []), v]);
  }

  const chats = new Map();
  for (const { chat_id: chatId, category } of subscriptions) {
    if (fresh.has(category)) chats.set(chatId, [...(chats.get(chatId) || []), category]);
  }

  let sent = 0;
  let removed = 0;
  for (const [chatId, list] of chats) {
    const sections = list.map((category) => ({ category, items: fresh.get(category) }));
    try {
      await deps.send(chatId, digestText(sections, deps));
      sent += 1;
    } catch (err) {
      if (/Forbidden|chat not found|user is deactivated/i.test(err.message)) {
        await unsubscribeAll(chatId);
        removed += 1;
      } else {
        console.error(`[подписка] ${chatId}:`, err.message);
      }
    }
    await pause(PAUSE_MS);
  }
  await writeCursor(maxId);
  if (sent || removed) console.log(`[подписка] разослал: ${sent}, убрал заблокировавших: ${removed}`);
  return { sent, removed };
}

function start(deps) {
  const run = () => digest(deps).catch((err) => console.error('[подписка]', err.message));
  setInterval(run, EVERY_MS).unref();
}

module.exports = { onMessage, onCallback, digest, start, categoriesOf, PROFESSIONS };

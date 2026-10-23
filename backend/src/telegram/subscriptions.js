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
const { tag } = require('../sourceTag');
const { esc } = require('./api');

const PROFESSIONS = landings.filter((l) => l.category);
// Задачи биржи — не профессия, а отдельная подписка для исполнителей: заказчик
// разместил задачу, админ её одобрил — подписчик получает её сразу, а не
// часовой подборкой (см. notifyTask и taskShare.js). Кто откликнулся первым,
// того заказчик и видит первым. В таблице — та же строка категории; у вакансий
// такой категории нет, и часовая подборка её не задевает.
const TASKS = { slug: 'birzha', category: 'Задачи биржи' };
// «Студентам» — тоже не профессия, а пометка «можно совмещать с учёбой» (см.
// students.js): в подборку идут вакансии с этой пометкой из любой категории.
// Студенты — заметная часть подписчиков из Threads, а своей кнопки у них не было.
const STUDENTS = { slug: 'studentam', category: 'Студентам' };
const bySlug = (slug) =>
  [TASKS, STUDENTS].find((s) => s.slug === slug) || PROFESSIONS.find((p) => p.slug === slug) || null;
const byCategory = (category) =>
  (category === STUDENTS.category ? STUDENTS : PROFESSIONS.find((p) => p.category === category)) || null;

// Шлём днём: с 9:00 до 21:59 по Бишкеку (UTC+6). Ночные вакансии придут
// утренней подборкой — курсор помнит, докуда дошли.
const HOUR_FROM = 9;
const HOUR_TO = 21;
const BISHKEK_OFFSET_H = 6;
const PER_CATEGORY = 5;
const SAMPLE = 3;
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
  const rows = [
    [{ text: `${set.has(TASKS.category) ? '✅ ' : ''}⚡ Задачи биржи — сразу`, callback_data: `sub:${TASKS.slug}` }],
    [{ text: `${set.has(STUDENTS.category) ? '✅ ' : ''}🎓 Студентам`, callback_data: `sub:${STUDENTS.slug}` }],
  ];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  if (set.size) rows.push([{ text: '🔕 Отписаться от всех', callback_data: 'sub:off' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

function menuText(chosen, lead = '') {
  return [
    ...(lead ? [lead, ''] : []),
    '🔔 Новые вакансии — прямо сюда.',
    `Нажмите на свою профессию: раз в час, с ${HOUR_FROM}:00 до ${HOUR_TO}:00, пришлю новые вакансии — и только когда они есть.`,
    'Кесибиңизди тандаңыз — жаңы вакансияларды саат сайын ушул жерге жиберем.',
    '',
    '⚡ Задачи биржи — пришлю сразу, как появятся: предложите цену первым.',
    '',
    chosen.length ? `Сейчас: ${chosen.join(', ')}` : 'Пока ничего не выбрано.',
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
    if (profession) await sample(chatId, profession, deps);
    return true;
  }
  if (text === '/subs' || (!admin && text === '/start')) {
    await showMenu(chatId, deps);
    return true;
  }
  if (text === '/stop') {
    await unsubscribeAll(chatId);
    await deps.send(chatId, 'Отписал от всего: вакансий и задач больше не пришлю. Вернуться — /start.');
    return true;
  }
  return false;
}

// Сразу после подписки — несколько последних вакансий по ней. Иначе человек
// нажимал кнопку и до следующего часа не видел ничего, кроме галочки, — и не
// понимал, что именно будет приходить. Пусто — молчим: меню уже ответило.
async function sample(chatId, profession, deps) {
  if (profession === TASKS) return;
  const students = profession === STUDENTS;
  const { rows } = await db.query(
    `SELECT id, title, city, salary_min FROM vacancies
      WHERE status = 'open' AND ${students ? 'for_students' : 'category = $2'}
      ORDER BY id DESC LIMIT $1`,
    students ? [SAMPLE] : [SAMPLE, profession.category]
  );
  if (!rows.length) return;
  await deps.send(
    chatId,
    [`Последние вакансии — <b>${esc(profession.category)}</b>:`, ...rows.map((v) => vacancyLine(v, deps))].join('\n\n')
  );
}

// Кнопка под меню. true — наша.
async function onCallback(query, deps) {
  const { answer, edit } = deps;
  const data = String(query.data || '');
  if (!data.startsWith('sub:')) return false;
  const chatId = query.message.chat.id;
  const slug = data.slice(4);

  let note = '';
  let added = null;
  if (slug === 'off') {
    await unsubscribeAll(chatId);
    note = 'Отписал от всех';
  } else {
    const profession = bySlug(slug);
    if (!profession) {
      await answer(query.id, 'Такой подписки уже нет');
      return true;
    }
    const chosen = await categoriesOf(chatId);
    if (chosen.includes(profession.category)) {
      await unsubscribe(chatId, profession.category);
      note = `Отписал: ${profession.category}`;
    } else {
      await subscribe(chatId, profession.category);
      note = `Подписал: ${profession.category}`;
      added = profession;
    }
  }
  await answer(query.id, note);
  const chosen = await categoriesOf(chatId);
  await edit(chatId, query.message.message_id, keyboard(chosen));
  if (added) await sample(chatId, added, deps);
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

// Ссылка тегом: в тексте — чистый адрес, а в самой ссылке — метка бота (см.
// sourceTag.js), чтобы Метрика отличала заходы из подборки от прямых.
const linkTo = (url, pretty) => `<a href="${esc(tag(url, 'bot'))}">${esc(pretty(url))}</a>`;

function vacancyLine(v, { siteUrl, pretty }) {
  const pay = v.salary_min ? `, от ${money(v.salary_min)} сом` : '';
  return `• ${esc(v.title)} — ${esc(v.city)}${pay}\n${linkTo(`${siteUrl}/vacancies/${v.id}`, pretty)}`;
}

function digestText(sections, deps) {
  const parts = ['🔔 <b>Новые вакансии</b>'];
  for (const { category, items } of sections) {
    const shown = items.slice(0, PER_CATEGORY);
    const lines = [`<b>${esc(category)}</b>`, ...shown.map((v) => vacancyLine(v, deps))];
    const rest = items.length - shown.length;
    const page = byCategory(category);
    if (rest > 0 && page) lines.push(`Ещё ${rest} — ${linkTo(`${deps.siteUrl}/rabota/${page.slug}`, deps.pretty)}`);
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
  const add = (key, v) => fresh.set(key, [...(fresh.get(key) || []), v]);
  const students = categories.includes(STUDENTS.category);
  if (categories.length) {
    const { rows } = await db.query(
      `SELECT id, title, city, salary_min, category, for_students FROM vacancies
        WHERE id > $1 AND id <= $2 AND status = 'open' AND (category = ANY($3::text[]) OR ($4 AND for_students))
        ORDER BY id DESC`,
      [cursor, maxId, categories, students]
    );
    for (const v of rows) {
      if (categories.includes(v.category)) add(v.category, v);
      if (students && v.for_students) add(STUDENTS.category, v);
    }
  }

  const chats = new Map();
  for (const { chat_id: chatId, category } of subscriptions) {
    if (fresh.has(category)) chats.set(chatId, [...(chats.get(chatId) || []), category]);
  }

  let sent = 0;
  let removed = 0;
  for (const [chatId, list] of chats) {
    // «Студентам» — последним и без вакансий, которые уже есть выше по
    // профессии: подписанный на «Общепит» и «Студентам» не получит одну
    // вакансию дважды в одном сообщении.
    const seen = new Set();
    const sections = [];
    for (const category of [...list].sort((a, b) => (a === STUDENTS.category) - (b === STUDENTS.category))) {
      const items = fresh.get(category).filter((v) => !seen.has(v.id));
      items.forEach((v) => seen.add(v.id));
      if (items.length) sections.push({ category, items });
    }
    if (!sections.length) continue;
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

function taskText(task, { siteUrl, pretty }) {
  const pay = task.budget ? `💰 ${money(task.budget)} сом` : '💰 цену предлагаете вы';
  const where = task.work_format === 'online' ? 'удалённо' : task.city;
  const about = String(task.description || '').trim();
  const short = about.length > 300 ? `${about.slice(0, 300).replace(/\s+\S*$/, '')}…` : about;
  return [
    '⚡ <b>Новая задача на бирже</b>',
    '',
    `<b>${esc(task.title)}</b>`,
    `📍 ${esc(where)} · ${pay}`,
    ...(task.when_text ? [`🗓 ${esc(task.when_text)}`] : []),
    ...(short ? ['', esc(short)] : []),
    '',
    `Предложить цену и срок: ${linkTo(`${siteUrl}/tasks/${task.id}`, pretty)}`,
    '',
    'Настроить подписки — /subs',
  ].join('\n');
}

// Задача биржи — всем подписанным на задачи, сразу и в любое время: её одобрил
// админ, а он не спит по ночам за ботом. { sent, removed } — как у подборки.
async function notifyTask(task, { pause = (ms) => new Promise((r) => setTimeout(r, ms)), ...deps }) {
  const { rows } = await db.query('SELECT chat_id FROM subscriptions WHERE category = $1', [TASKS.category]);
  const text = taskText(task, deps);
  let sent = 0;
  let removed = 0;
  for (const { chat_id: chatId } of rows) {
    try {
      await deps.send(chatId, text);
      sent += 1;
    } catch (err) {
      if (/Forbidden|chat not found|user is deactivated/i.test(err.message)) {
        await unsubscribeAll(chatId);
        removed += 1;
      } else {
        console.error(`[подписка] задача ${task.id} → ${chatId}:`, err.message);
      }
    }
    await pause(PAUSE_MS);
  }
  return { sent, removed };
}

async function taskSubscribers() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM subscriptions WHERE category = $1', [TASKS.category]);
  return rows[0].n;
}

// Для сводки (см. summary.js): сколько людей подписано и на что — по ним видно,
// работают ли кнопки на сайте и строка подписки в Threads (social/subLine.js).
async function stats() {
  const [total, byCategory] = await Promise.all([
    db.query('SELECT COUNT(DISTINCT chat_id)::int AS chats FROM subscriptions'),
    db.query('SELECT category, COUNT(*)::int AS n FROM subscriptions GROUP BY category ORDER BY n DESC, category'),
  ]);
  return { chats: total.rows[0].chats, byCategory: byCategory.rows };
}

function start(deps) {
  const run = () => digest(deps).catch((err) => console.error('[подписка]', err.message));
  setInterval(run, EVERY_MS).unref();
}

module.exports = {
  onMessage,
  onCallback,
  digest,
  notifyTask,
  taskSubscribers,
  stats,
  start,
  categoriesOf,
  PROFESSIONS,
  TASKS,
  STUDENTS,
};

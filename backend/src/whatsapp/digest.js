// Подборки в WhatsApp-канал по расписанию (см. channel.js) — чтобы канал жил
// каждый день: чем чаще в нём посты, тем охотнее WhatsApp показывает его в
// «Обновлениях» тем, кто на него ещё не подписан.
//
// Пять раз в день, в 9, 12, 15, 18 и 21 по Бишкеку (WA_HOURS): в 15:00 —
// подработка на сегодня, в остальные — вакансии новее прошлой подборки. Номеров
// в посте нет: в открытом канале их соберут спамеры, а звонок с карточки на
// сайте — тот самый переход, ради которого канал. У каждой строки своя ссылка
// с меткой w (см. sourceTag.js), по ней Метрика видит заходы из WhatsApp.
//
// Устроено как рубрики Telegram (см. telegram/rubrics.js): обход раз в 10 минут,
// слот занимается в базе до выхода, итог — в счётчиках сводки.
const feedStats = require('../telegram/feedStats');
const repo = require('../rubricsRepo');
const { money } = require('../money');
const { tag } = require('../sourceTag');
const { clamp } = require('../telegram/format');

const HOUR_MS = 60 * 60 * 1000;
const TICK_MS = 10 * 60 * 1000;
// Render проспал слот — выходим позже, но не дольше двух часов: дальше уже
// следующий слот.
const LATE_HOURS = 2;
const MIN_ITEMS = 3;
const LIMIT = 5;
const TITLE_MAX = 60;
const ORDERS_HOUR = 15;
const SLOT_KEY = 'wa:slot';
const CURSOR_KEY = 'wa:last_vacancy_id';
const DEFAULT_HOURS = [9, 12, 15, 18, 21];

// WA_HOURS — часы через запятую; off — ни одной; пусто — по умолчанию.
function parseHours(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return DEFAULT_HOURS;
  if (/^(off|no|нет|-)$/i.test(raw)) return [];
  const hours = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{1,2}$/.test(s))
    .map(Number)
    .filter((h) => h <= 23);
  return [...new Set(hours)].sort((a, b) => a - b);
}
const HOURS = parseHours(process.env.WA_HOURS);

// Название — без разметки WhatsApp (*жирный*, _курсив_, ~зачёркнутый~) и без
// номера, если автор вписал его прямо в заголовок.
const plain = (title) =>
  String(title || '')
    .replace(/[*_~`]/g, '')
    .replace(/\+?\d[\d\s()-]{6,}\d/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s,;:—-]+$/, '');

function salaryText({ min, max }) {
  if (!min) return '';
  return max && max > min ? `${money(min)}–${money(max)} сом` : `от ${money(min)} сом`;
}

const KINDS = {
  vacancy: {
    head: '💼 Свежие вакансии',
    more: 'Все вакансии',
    describe: (item) => [salaryText(item.salary), item.parsed.city].filter(Boolean).join(', '),
  },
  order: {
    head: '🧰 Подработка на сегодня',
    more: 'Все заказы',
    describe: ({ parsed }) => [parsed.budget ? `${money(parsed.budget)} сом` : '', parsed.city].filter(Boolean).join(', '),
  },
};

function render(type, items, { siteUrl, pretty }) {
  const kind = KINDS[type];
  const list = siteUrl(type);
  const link = (url) => (list ? pretty(tag(url, 'whatsapp')) : '');
  const lines = [kind.head, ''];
  items.forEach((item, i) => {
    lines.push(`${i + 1}. ${clamp(plain(item.parsed.title), TITLE_MAX)} — ${kind.describe(item)}`);
    if (list) lines.push(`👉 ${link(`${list}/${item.id}`)}`);
    lines.push('');
  });
  if (list) lines.push(`${kind.more}: ${link(list)}`);
  lines.push('Перешлите тому, кто ищет работу 🙌');
  return lines.join('\n');
}

// Пост для слота или null, если подборки не набралось. cursor — докуда дошли
// по вакансиям: двигаем только после выхода.
async function make(deps, slot) {
  if (slot === ORDERS_HOUR) {
    const items = await repo.freshOrders({ limit: LIMIT });
    return items.length < MIN_ITEMS ? null : { text: render('order', items, deps) };
  }
  const afterId = Number(await feedStats.getSetting(CURSOR_KEY)) || 0;
  const items = await repo.freshVacancies({ afterId, limit: LIMIT });
  if (items.length < MIN_ITEMS) return null;
  return { text: render('vacancy', items, deps), cursor: Math.max(...items.map((item) => item.id)) };
}

// Отправить готовую подборку. Возвращает 'ok' | 'skip' | 'fail'.
async function send(deps, post) {
  if (!post) {
    await feedStats.bump('wa.skip');
    return 'skip';
  }
  try {
    await deps.post(post.text);
  } catch (err) {
    console.error('[whatsapp] подборка не вышла:', err.message);
    await feedStats.bump('wa.fail');
    return 'fail';
  }
  if (post.cursor) await feedStats.setSetting(CURSOR_KEY, post.cursor).catch(() => {});
  await feedStats.bump('wa.ok');
  return 'ok';
}

const failed = async (err) => {
  console.error('[whatsapp] выборка не удалась:', err.message);
  await feedStats.bump('wa.fail');
  return 'fail';
};

// Подборка вне расписания (/whatsapp now): вакансии.
async function publish(deps) {
  let post;
  try {
    post = await make(deps, null);
  } catch (err) {
    return failed(err);
  }
  return send(deps, post);
}

// Один обход. Слот занимаем до выхода: перезапуск посреди выхода лучше потеряет
// подборку, чем выложит её дважды. Не ответила база — слот освобождаем, и
// следующий обход попробует снова. null — выпускать сейчас нечего.
let busy = false;
async function tick(deps, now = Date.now()) {
  if (busy || !HOURS.length) return null;
  busy = true;
  try {
    const hour = new Date(now + 6 * HOUR_MS).getUTCHours();
    const slot = [...HOURS].reverse().find((h) => h <= hour && hour < h + LATE_HOURS);
    if (slot === undefined) return null;
    if (!(await feedStats.claimSetting(SLOT_KEY, `${feedStats.today(now)} ${slot}`))) return null;
    let post;
    try {
      post = await make(deps, slot);
    } catch (err) {
      await feedStats.setSetting(SLOT_KEY, '').catch(() => {});
      return failed(err);
    }
    return await send(deps, post);
  } finally {
    busy = false;
  }
}

// deps — от бота: siteUrl(type) — адрес списка на сайте, pretty(url) — как его
// показать, post(text) — отправка в канал (channel.post).
function start(deps) {
  if (!HOURS.length) return;
  const run = () => tick(deps).catch((err) => console.error('[whatsapp]', err));
  setInterval(run, TICK_MS).unref();
  setTimeout(run, 2 * 60 * 1000).unref();
  console.log(`[whatsapp] подборки в ${HOURS.join(', ')} (в ${ORDERS_HOUR} — подработка)`);
}

module.exports = { tick, publish, start, parseHours, HOURS, ORDERS_HOUR };

// Рубрики — посты из базы по расписанию, ради которых на Шабашку подписываются.
// Нашедший одно объявление уходит, а тот, кто ждёт завтрашнего топа, остаётся.
// Поток объявлений не трогаем: рубрики идут сверху, один-два поста в день.
//
// Выходят в Threads и Telegram-канал, а подборки объявлений — ещё и роликом в
// Instagram (см. shareRubric в social/index.js). Очередь — как у рекламы, иначе
// «в 9:00» за потоком из групп стало бы «к обеду». Итог — в счётчиках сводки.
const tg = require('./api');
const feedStats = require('./feedStats');
const repo = require('../rubricsRepo');
const social = require('../social');
const { weight, THREADS_LIMIT } = require('../social/video');
const { money } = require('../money');
const { tag } = require('../sourceTag');
const { clamp, plural } = require('./format');

const HOUR_MS = 60 * 60 * 1000;
const TICK_MS = 10 * 60 * 1000;
// Проспали час выхода (Render засыпает) — выходим позже, но в пределах трёх
// часов: топ «дня» к вечеру уже не топ дня.
const LATE_HOURS = 3;
// Меньше трёх — не подборка: рубрика в этот день пропускается.
const MIN_ITEMS = 3;
const TITLE_MAX = 40;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const salaryText = ({ min, max }) => (max && max > min ? `${money(min)}–${money(max)} сом` : `от ${money(min)} сом`);
// У студентов зарплата не обязательна (топ берёт только с ней): без неё — город,
// а не «от null сом».
const salaryAndCity = (item) =>
  item.salary.min ? `${salaryText(item.salary)}, ${item.parsed.city}` : item.parsed.city;

const numbered = (items, describe) =>
  items.map((item, i) => `${i + 1}. ${clamp(item.parsed.title, TITLE_MAX)} — ${describe(item)}`);

// Что выходит и когда. hour — час по Бишкеку, days — дни недели (0 — воскресенье).
// make(deps) отдаёт пост или null, если данных на подборку мало. head и
// collection — от числа строк: длинный пост ужимается (см. render), и «Топ-5»
// над четырьмя строками было бы враньём.
const RUBRICS = [
  {
    key: 'top',
    hour: 9,
    days: EVERY_DAY,
    async make(deps) {
      // За сутки — чтобы вчерашний топ не повторялся сегодня; мало — за двое.
      let items = await repo.topSalary({ days: 1 });
      if (items.length < MIN_ITEMS) items = await repo.topSalary({ days: 2 });
      if (items.length < MIN_ITEMS) return null;
      return {
        head: (n) => `💰 Топ-${n} ${plural(n, ['вакансия', 'вакансии', 'вакансий'])} дня по зарплате`,
        lines: numbered(items, salaryAndCity),
        more: { label: 'Все вакансии', url: deps.siteUrl('vacancy') },
        // Без «в 9:00»: проспал Render — топ выходит до полудня (LATE_HOURS).
        tail: '🔔 Подпишись — топ по зарплате каждое утро',
        items,
        collection: (n) => `Топ-${n} по зарплате`,
        cta: 'все вакансии на сайте',
      };
    },
  },
  {
    key: 'orders',
    hour: 13,
    days: EVERY_DAY,
    async make(deps) {
      const items = await repo.freshOrders();
      if (items.length < MIN_ITEMS) return null;
      return {
        head: () => '🧰 Подработка на сегодня — свежие заказы',
        lines: numbered(items, ({ parsed }) =>
          parsed.budget ? `${money(parsed.budget)} сом, ${parsed.city}` : parsed.city
        ),
        more: { label: 'Все заказы', url: deps.siteUrl('order') },
        tail: '🔔 Подпишись — свежая подработка каждый день',
        items,
        collection: () => 'Подработка на сегодня',
        cta: 'все заказы на сайте',
      };
    },
  },
  {
    key: 'students',
    hour: 17,
    days: [1, 3, 5],
    async make(deps) {
      const items = await repo.forStudents();
      if (items.length < MIN_ITEMS) return null;
      return {
        head: () => '🎓 Работа для студентов — свежие вакансии',
        lines: numbered(items, salaryAndCity),
        more: { label: 'Все вакансии', url: deps.siteUrl('vacancy') },
        tail: '🔔 Подпишись — подборка для студентов по пн, ср и пт',
        items,
        collection: () => 'Работа для студентов',
        cta: 'все вакансии на сайте',
      };
    },
  },
  {
    // Своих данных такого рода нет ни у кого: сколько на самом деле платят по
    // объявлениям, а не по опросам. Ролика нет — кадры собираются из объявлений.
    key: 'salaries',
    hour: 12,
    days: [0],
    async make(deps) {
      const rows = await repo.salaryStats();
      if (rows.length < MIN_ITEMS) return null;
      const total = rows.reduce((sum, row) => sum + row.n, 0);
      return {
        // «Предлагают», а не «платят»: это зарплата «от» из объявлений. И не
        // «средняя»: медиана — середина, её и объясняем словами.
        head: () => '📊 Сколько предлагают в Бишкеке',
        lines: [...rows].sort((a, b) => b.median - a.median).map((row) => `${row.category} — ${money(row.median)} сом`),
        note: `Зарплата «от» — середина по ${total} ${plural(total, ['вакансии', 'вакансиям', 'вакансиям'])} за месяц: половина предлагает больше, половина — меньше.`,
        more: { label: 'Все вакансии', url: deps.siteUrl('vacancy') },
        tail: '🔔 Подпишись — новая сводка каждое воскресенье',
        items: [],
        collection: () => '',
        cta: '',
      };
    },
  },
];

const KEYS = RUBRICS.map((r) => r.key);

// RUBRICS — какие выходят, через запятую; off — ни одной; пусто — все.
function parseList(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return KEYS;
  if (/^(off|no|нет|-)$/i.test(raw)) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((key) => KEYS.includes(key));
}
const ENABLED = parseList(process.env.RUBRICS);

// Текст для Threads и HTML для Telegram. Не влезает в 500 знаков Threads —
// убираем строки с конца, но не меньше трёх. В Telegram строки «подпишись» нет
// (его читают уже вступившие), а ссылка — тегом: кириллический адрес Telegram
// сам не подсвечивает. Метка площадки (см. sourceTag.js): в тексте — Threads
// (в Instagram текст рубрики не уходит), в теге — Telegram.
function render(post, pretty = (url) => url) {
  const url = post.more && post.more.url;
  const body = (n) => [post.head(n), '', ...post.lines.slice(0, n), ...(post.note ? [post.note] : [])];
  const text = (n) =>
    [...body(n), '', ...(url ? [`${post.more.label} — ${pretty(tag(url, 'threads'))}`] : []), post.tail].join('\n');
  let n = post.lines.length;
  while (n > MIN_ITEMS && weight(text(n)) > THREADS_LIMIT) n -= 1;
  const link = url ? `\n\n<a href="${tag(url, 'telegram')}">${tg.esc(pretty(url))}</a>` : '';
  return {
    text: text(n),
    html: `${tg.esc(body(n).join('\n'))}${link}`,
    items: post.items.slice(0, n),
    collection: post.collection(n),
  };
}

async function publish(post, deps) {
  const { text, html, items, collection } = render(post, deps.pretty);
  const [result, inChannel] = await Promise.all([
    social
      .shareRubric({ text, items, collection, cta: post.cta })
      .catch((err) => ({ threads: { posted: false, reason: err.message }, instagram: null })),
    deps.channel
      ? deps
          .channel(html)
          .then(() => true)
          .catch((err) => {
            console.error('[рубрики] в канал не ушло:', err.message);
            return false;
          })
      : false,
  ]);
  return inChannel || [result.threads, result.instagram].some((r) => r && r.posted);
}

// Один обход: первая рубрика, чьё окно сейчас открыто и которая сегодня ещё не
// выходила. Одна за обход — две рубрики подряд в ленте выглядели бы потоком.
// Отметку «выпущено сегодня» ставим до выхода: перезапуск посреди выхода лучше
// потеряет рубрику, чем выложит её дважды. Не ответила база — отметку снимаем,
// и следующий обход попробует снова, пока окно открыто.
// Возвращает 'ok' | 'fail' | 'skip' или null, если выпускать нечего.
let busy = false;
async function tick(deps, now = Date.now()) {
  if (busy) return null;
  busy = true;
  try {
    const local = new Date(now + 6 * HOUR_MS);
    const hour = local.getUTCHours();
    const day = feedStats.today(now);
    for (const rubric of RUBRICS) {
      if (!ENABLED.includes(rubric.key) || !rubric.days.includes(local.getUTCDay())) continue;
      if (hour < rubric.hour || hour >= rubric.hour + LATE_HOURS) continue;
      const mark = `rubric:${rubric.key}`;
      if (!(await feedStats.claimSetting(mark, day))) continue;

      let post;
      try {
        post = await rubric.make(deps);
      } catch (err) {
        console.error(`[рубрики] ${rubric.key}: выборка не удалась:`, err.message);
        await feedStats.setSetting(mark, '').catch(() => {});
        await feedStats.bump('rub.fail');
        return 'fail';
      }
      if (!post) {
        await feedStats.bump('rub.skip');
        return 'skip';
      }
      // Отметка уже стоит: упади выход молча — рубрика пропала бы без следа в
      // сводке. Повтора нет — часть площадок могла и выйти.
      const ok = await publish(post, deps).catch((err) => {
        console.error(`[рубрики] ${rubric.key}: выход не удался:`, err.message);
        return false;
      });
      await feedStats.bump(ok ? 'rub.ok' : 'rub.fail');
      return ok ? 'ok' : 'fail';
    }
    return null;
  } finally {
    busy = false;
  }
}

// deps — от бота: siteUrl(type) — адрес списка на сайте, pretty(url) — как его
// показать, channel(html) — пост в канал (null — канала нет).
function start(deps) {
  if (!ENABLED.length) return;
  const run = () => tick(deps).catch((err) => console.error('[рубрики]', err));
  setInterval(run, TICK_MS).unref();
  setTimeout(run, 90 * 1000).unref();
  console.log(`[рубрики] ${ENABLED.join(', ')}`);
}

module.exports = { tick, start, parseList, render, RUBRICS };

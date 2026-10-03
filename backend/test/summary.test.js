// Сводка вместо потока «кто что опубликовал» (см. src/telegram/summary.js):
// числа из счётчиков, реклама с просмотрами, и по расписанию — ровно одна в
// назначенный час, даже если сервис перезапустился.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, statsStub, at, chat } = require('./helpers/stub');

process.env.SUMMARY_HOURS = '9,13,21';

const tg = chat();
const stats = statsStub();
const settings = new Map();
stats.feedStats.getSetting = async (key) => settings.get(key) || null;
stats.feedStats.setSetting = async (key, value) => settings.set(key, value);

const HOUR = 3600 * 1000;
const campaign = { id: 3, title: 'Кофейня ищет бариста', goal: 1000, created_at: new Date(Date.now() - 5 * HOUR) };

const requireSrc = install({
  [at('telegram/api.js')]: tg.api,
  [at('telegram/extract.js')]: {
    KEY_COUNT: 1,
    usage: () => ({
      tokens: 412000,
      calls: 96,
      keys: 2,
      models: [
        { model: 'qwen/qwen3.8-27b', until: Date.now() + HOUR },
        { model: 'openai/gpt-oss-120b', reserve: true },
      ],
    }),
  },
  [at('telegram/feedStats.js')]: stats.feedStats,
  [at('social/index.js')]: {
    BATCH_SIZE: 3,
    RELEASE_INTERVAL_MIN: 150,
    pending: () => 0,
    queuedByType: () => [],
    threadsQueued: () => 2,
    collectionTitle: () => 'Заказы дня',
    quota: { used: () => 3, dailyLimit: () => 8, hardLimit: () => 10 },
    adTracker: {
      GOAL: 1000,
      REPORT_AFTER_MS: 24 * HOUR,
      recent: async () => [campaign],
      refresh: async () => ({ totals: { views: 640 } }),
      totalsOf: () => ({ views: 0 }),
      postsOf: async () => [],
      summary: async () => ({ reported: 6, met: 5 }),
      ageOf: (c) => Date.now() - new Date(c.created_at).getTime(),
    },
  },
});

const summary = requireSrc('telegram/summary.js');

Object.assign(stats.counters, {
  'grp.ok.vacancy': 12,
  'grp.ok.order': 9,
  'grp.ok.board': 10,
  'grp.no.mlm': 14,
  'grp.no.drop': 2,
  'grp.dup': 8,
  'grp.no.other': 30,
  'ad.ok': 1,
  'th.ok': 30,
  'th.fail': 1,
  'ig.reel': 6,
  'ig.image': 2,
});

test('сводка: из групп отдельно, реклама отдельно, причины отсева названы', async () => {
  const { text, grpOk } = await summary.build({ previous: 19 });
  assert.equal(grpOk, 31);
  assert.match(text, /Сегодня опубликовано: 32/);
  assert.match(text, /Вышло: 31 \(\+12 с прошлой сводки\) — 💼 12 · 🧰 9 · 📌 10/);
  assert.match(text, /Отсеял: 54 — сетевой маркетинг 14 · чужие документы 2 · повторы 8 · не объявление 30/);
  assert.match(text, /📣 Реклама\nСегодня выложено: 1\n1\. «Кофейня ищет бариста» — 👁 640 просмотров ⏳ 5 ч/);
  // Между разрядами — неразрывный пробел (см. num): \s его ловит.
  assert.match(text, /гарантию 1\s000\+ набрали 5 из 6/);
  assert.match(text, /Threads: 30 · не вышло 1/);
  assert.match(text, /роликов 6, картинкой 2/);
  assert.match(text, /qwen3\.8-27b ⏳ до/);
  assert.match(text, /берегу под рекламу/, 'резерв в деле — сказано');
  assert.doesNotMatch(text, /Роликов в работе/, 'технические строки — только в /stats');
});

test('в /stats к сводке добавляются очереди и квота', async () => {
  const { text } = await summary.build({ tech: true });
  assert.match(text, /Ждут очереди в Threads: 2/);
  assert.match(text, /Публикаций в Instagram за сутки: 3 из 8/);
});

// 13:10 по Бишкеку = 07:10 UTC.
const at1310 = Date.UTC(2026, 9, 3, 7, 10);

test('по расписанию — одна сводка в час, и перезапуск второй не шлёт', async () => {
  const sent = [];
  const send = async (text) => sent.push(text);

  assert.equal(await summary.tick(send, { now: Date.UTC(2026, 9, 3, 6, 10) }), false, '12:10 — не час сводки');
  assert.equal(await summary.tick(send, { now: at1310 }), true);
  assert.equal(await summary.tick(send, { now: at1310 + 5 * 60 * 1000 }), false, 'второй раз в тот же час — нет');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Сводка за сегодня, 13:10/);
  assert.match(settings.get('summary:last'), /"key":"2026-10-03:13"/, 'отметка в базе — переживёт перезапуск');
});

test('последняя сводка дня называется итогом', async () => {
  const sent = [];
  await summary.tick(async (text) => sent.push(text), { now: Date.UTC(2026, 9, 3, 15, 2) });
  assert.match(sent[0], /^📊 Итог дня, 21:02/);
  assert.match(sent[0], /\+0 с прошлой сводки/, 'разница — с той, что была в 13:00');
});

test('часы сводки: off выключает, мусор отбрасывается', () => {
  assert.deepEqual(summary.parseHours('off'), []);
  assert.deepEqual(summary.parseHours('21, 9,x,25,9'), [9, 21]);
  assert.deepEqual(summary.parseHours(undefined), [9, 13, 17, 21]);
});

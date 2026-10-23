// Сводка вместо потока «кто что опубликовал» (см. src/telegram/summary.js):
// числа из счётчиков, реклама с просмотрами, и по расписанию — ровно одна в
// назначенный час, даже если сервис перезапустился.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, statsStub, at, chat } = require('./helpers/stub');

process.env.SUMMARY_HOURS = '9,13,21';
process.env.TELEGRAM_CHANNEL_ID = '@shabashka';

const tg = chat();
tg.api.call = async (method) => (method === 'getChatMemberCount' ? 410 : { ok: true });
const stats = statsStub();
const HOUR = 3600 * 1000;
const settings = new Map();
stats.feedStats.getSetting = async (key) => settings.get(key) || null;
stats.feedStats.setSetting = async (key, value) => settings.set(key, value);
// День по Бишкеку, как в feedStats: снимок подписчиков — за сегодня, прирост — от вчера.
stats.feedStats.today = (now = Date.now()) => new Date(now + 6 * HOUR).toISOString().slice(0, 10);

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
    followers: async () => ({ threads: 1240, instagram: 830 }),
    collectionTitle: () => 'Заказы дня',
    quota: { used: () => 3, dailyLimit: () => 8, hardLimit: () => 10, adLimit: () => 100 },
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
  [at('telegram/products.js')]: {
    summaryLines: async () => ['🛍 Мои продукты', '• Scroll Book — Threads 11:20 👁 340 · Instagram 11:21 ✅'],
  },
  // Подписка в боте ходит в базу — сводке хватает её чисел.
  [at('telegram/subscriptions.js')]: { stats: async () => botStats() },
});

let botStats = () => ({
  chats: 45,
  byCategory: [
    { category: 'Общепит', n: 12 },
    { category: 'Продажи', n: 8 },
    { category: 'Задачи биржи', n: 3 },
    { category: 'Охрана', n: 2 },
    { category: 'Офис', n: 1 },
    { category: 'Уборка', n: 1 },
  ],
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
  assert.match(
    text,
    /\n\n🛍 Мои продукты\n• Scroll Book — Threads 11:20 👁 340 · Instagram 11:21 ✅\n/,
    'продукты — отдельным блоком: вышли ли и сколько набрали'
  );
  assert.doesNotMatch(text, /Роликов в работе/, 'технические строки — только в /stats');
});

test('в /stats к сводке добавляются очереди и квота', async () => {
  const { text } = await summary.build({ tech: true });
  assert.match(text, /Ждут очереди в Threads: 2/);
  assert.match(
    text,
    /Публикаций в Instagram за сутки: 3 — объявлениям до 8; рекламе, продуктам и рубрикам — до 100/,
    'потолок 10 — только для объявлений, и это видно'
  );
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

test('подписчики площадок — с приростом от вчерашнего снимка', async () => {
  settings.set('followers:2026-10-02', JSON.stringify({ threads: 1228, instagram: 831, channel: 405, bot: 42 }));
  const { text } = await summary.build({ now: at1310 });
  assert.match(text, /👥 Подписчики: Threads 1\s240 \(\+12\) · Instagram 830 \(−1\) · Telegram 410 \(\+5\) · Бот 45 \(\+3\)\n/);
  assert.deepEqual(JSON.parse(settings.get('followers:2026-10-03')), { threads: 1240, instagram: 830, channel: 410, bot: 45 });

  // Площадка не ответила — её просто нет в строке, сводка не падает.
  settings.delete('followers:2026-10-03');
  tg.api.call = async () => {
    throw new Error('чат недоступен');
  };
  const { text: partial } = await summary.build({ now: at1310 });
  assert.match(partial, /👥 Подписчики: Threads 1\s240 \(\+12\) · Instagram 830 \(−1\) · Бот 45 \(\+3\)\n/);

  // Telegram ответил позже — его число дописывается в сегодняшний снимок, иначе
  // завтра у него не было бы прироста. Утренние числа остальных не трогаем.
  tg.api.call = async (method) => (method === 'getChatMemberCount' ? 412 : { ok: true });
  await summary.build({ now: at1310 + 4 * 3600 * 1000 });
  assert.deepEqual(JSON.parse(settings.get('followers:2026-10-03')), { threads: 1240, instagram: 830, channel: 412, bot: 45 });
});

// Подписка в боте (см. telegram/subscriptions.js): на что подписаны и сколько
// людей пришло по ссылкам — из постов Threads (social/subLine.js) и с сайта.
test('бот: профессии подписчиков и переходы за сегодня', async () => {
  Object.assign(stats.counters, { 'sub.click.threads': 7, 'sub.click.site': 3 });
  try {
    const { text } = await summary.build();
    assert.match(text, /\n🔔 В боте: Общепит 12 · Продажи 8 · Задачи биржи 3 · Охрана 2 · Офис 1 · …\n/);
    assert.match(text, /\n↪️ Перешли в бота сегодня: из Threads 7 · с сайта 3\n/);

    stats.counters['sub.click.other'] = 1;
    assert.match((await summary.build()).text, /из Threads 7 · с сайта 3 · без метки 1\n/);
  } finally {
    for (const key of ['sub.click.threads', 'sub.click.site', 'sub.click.other']) delete stats.counters[key];
  }

  // Ни подписчиков, ни переходов — строк нет; база не ответила — сводка не падает.
  const before = botStats;
  try {
    botStats = () => ({ chats: 0, byCategory: [] });
    assert.doesNotMatch((await summary.build()).text, /В боте|Перешли в бота/);
    botStats = () => {
      throw new Error('база недоступна');
    };
    assert.doesNotMatch((await summary.build()).text, /В боте|Бот \d/);
  } finally {
    botStats = before;
  }
});

test('рубрики — сколько вышло и почему нет', async () => {
  Object.assign(stats.counters, { 'rub.ok': 2, 'rub.skip': 1 });
  const { text } = await summary.build();
  assert.match(text, /📅 Рубрик: 2 · мало данных 1\n/);
  delete stats.counters['rub.ok'];
  delete stats.counters['rub.skip'];
  assert.doesNotMatch((await summary.build()).text, /Рубрик/, 'не было — строки нет');
});

test('часы сводки: off выключает, мусор отбрасывается', () => {
  assert.deepEqual(summary.parseHours('off'), []);
  assert.deepEqual(summary.parseHours('21, 9,x,25,9'), [9, 21]);
  assert.deepEqual(summary.parseHours(undefined), [9, 13, 17, 21]);
});

test('следом за сводкой — «Кому написать»; его сбой сводку не ломает', async () => {
  const sent = [];
  // 13:05 по Бишкеку, на другой день: этот час в тот уже занят.
  await summary.tick(async (text) => sent.push(text), {
    now: Date.UTC(2026, 9, 5, 7, 5),
    after: async () => sent.push('кому написать'),
  });
  assert.equal(sent.length, 2);
  assert.match(sent[0], /Сводка за сегодня, 13:05/);
  assert.equal(sent[1], 'кому написать', 'после сводки, а не до');

  const quiet = [];
  const ok = await summary.tick(async (text) => quiet.push(text), {
    now: Date.UTC(2026, 9, 6, 3, 5),
    after: async () => {
      throw new Error('нет сети');
    },
  });
  assert.equal(ok, true, 'сводка ушла — значит, отправлена');
  assert.equal(quiet.length, 1);
});

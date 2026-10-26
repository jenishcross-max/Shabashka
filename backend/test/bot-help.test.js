// Справка /start. Telegram не берёт сообщения длиннее 4096 знаков, поэтому
// справка нарочно разделена на две части — и растёт она каждый раз, когда у
// бота появляется новое поведение. Без этой проверки перебор замечается только
// в чате, ошибкой вместо ответа.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, dmStub, statsStub, at, chat, adGroupsStub, adRaisesStub, productStoreStub, subscriptionsStub, exchangeStubs } = require('./helpers/stub');

const tg = chat();
const stats = statsStub();

const groups = adGroupsStub();
const raises = adRaisesStub();

const subscriptions = subscriptionsStub();
const exchange = exchangeStubs();
const exchangeCalls = exchange[at('telegram/taskShare.js')].calls;
const requireSrc = install({
  ...exchange,
  [at('telegram/adGroups.js')]: groups,
  [at('telegram/productStore.js')]: productStoreStub(),
  [at('telegram/subscriptions.js')]: subscriptions,
  [at('telegram/adRaises.js')]: raises,
  [at('telegram/api.js')]: tg.api,
  [at('telegram/notify.js')]: {
    ADMIN_IDS: new Set(['1']),
    // Настоящая проверка, а не заглушка «всем можно»: последний тест ровно про
    // то, что чужому бот не отвечает.
    isAllowed: (id) => String(id) === '1',
    notifyAdmins: async () => {},
  },
  [at('telegram/extract.js')]: {
    usage: () => ({ tokens: 0, calls: 0, limit: 200000, keys: 1, left: 200000, reserve: 40000 }),
    PACE_MS: 35000,
    KEY_COUNT: 1,
    hasPhone: () => true,
    phoneFrom: () => null,
    fromText: async () => [],
  },
  [at('telegram/imports.js')]: { get: async () => null },
  [at('telegram/deferred.js')]: { add: async () => 1, remove: async () => {}, restorable: async () => [] },
  // Директ ходит в базу — боту в этих тестах он не нужен.
  [at('dm/index.js')]: dmStub(),
  // Счётчики сводки и чёрный список номеров — тоже база.
  [at('telegram/feedStats.js')]: stats.feedStats,
  [at('telegram/blocklist.js')]: stats.blocklist,
  [at('social/index.js')]: {
    onThreads: () => {},
    onReel: () => {},
    BATCH_SIZE: 3,
    RELEASE_INTERVAL_MIN: 150,
    THREADS_INTERVAL_MIN: 10,
    pending: () => 0,
    queuedByType: () => [],
    threadsQueued: () => 0,
    syncQuota: async () => {},
    collectionTitle: () => 'Заказы дня',
    adTracker: {
      WARN_AFTER_MS: 6 * 3600 * 1000,
      REPORT_AFTER_MS: 24 * 3600 * 1000,
      GOAL: 1000,
      MAX_BOOSTS: 2,
      start: () => {},
      recent: async () => [],
      track: async () => 1,
      addPost: async () => 1,
    },
    leads: { start: () => {} },
    adLine: () => '📣 Реклама',
    threadsConfigured: () => false,

    quota: { used: () => 0, dailyLimit: () => 8, hardLimit: () => 10, RESERVE: 2, adLimit: () => 100 },
    limits: async () => ({
      instagram: { used: 4, total: 100 },
      threads: { used: 1, total: 250 },
    }),
  },
  [at('digestRepo.js')]: { SIZE: 5, DAYS: 2 },
  // Рубрики по расписанию бот только запускает — выборки им здесь не нужны.
  [at('rubricsRepo.js')]: {},
});

const bot = requireSrc('telegram/bot.js');

const say = (text) =>
  bot.handleUpdate({ message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, message_id: 1, text } });

test('справка делится на части, и каждая влезает в сообщение Telegram', async () => {
  tg.clear();
  await say('/start');
  assert.ok(tg.sent.length >= 2, 'одним сообщением справка не влезает — их должно быть два');
  for (const part of tg.sent) {
    assert.ok(part.length <= 4096, `часть справки длиной ${part.length} знаков`);
  }
});

test('справка называет то, что бот делает на самом деле', async () => {
  const text = tg.sent.join('\n');
  assert.match(text, /\/ad/, 'платная реклама');
  assert.match(text, /\/ad_fast/, 'реклама без разбора');
  assert.match(text, /\/now/);
  assert.match(text, /\/top/);
  assert.match(text, /\/stats/);
  assert.match(text, /\/limits/);
  assert.match(text, /3 объявления в каждом/, 'про пачку сказано');
  assert.match(text, /150 минут/, 'и про расписание тоже');
  assert.match(text, /\/ads/, 'отчёты по рекламе');
  assert.match(text, /\/threads/, 'статистика Threads');
  assert.match(text, /1000 просмотров/, 'гарантия названа числом');
  assert.match(text, /⚡ Биржа/, 'про раздачу задач биржи');
  assert.match(text, /\/outreach/, '«кому написать»');
  assert.match(text, /Не больше 10 в день/);
  assert.match(text, /\/find 6683/, 'найти и снять объявление');
});

// «🔎 Найти и снять» (см. src/telegram/findListing.js) — только админу: снять
// чужое объявление с сайта постороннему нельзя.
test('/find — админу, постороннему — нет', async () => {
  exchangeCalls.length = 0;
  await say('/find 6683');
  assert.deepEqual(exchangeCalls, [{ find: '/find 6683' }]);

  exchangeCalls.length = 0;
  await bot.handleUpdate({
    message: { chat: { id: 99, type: 'private' }, from: { id: 779 }, message_id: 6, text: '/find 6683' },
  });
  assert.deepEqual(exchangeCalls, [], 'постороннему поиск не даём');
});

// Биржа (см. src/telegram/taskShare.js и outreach.js): /outreach и кнопки
// «Раздать» — только админу.
test('/outreach и «Раздать» — админу, постороннему — нет', async () => {
  exchangeCalls.length = 0;
  await say('/outreach');
  assert.deepEqual(exchangeCalls, [{ outreach: 1 }]);

  tg.clear();
  await bot.handleUpdate({
    callback_query: { id: 'q', data: 'tk:share:3', from: { id: 1 }, message: { chat: { id: 1 }, message_id: 5 } },
  });
  assert.equal(tg.sent.length, 0, 'кнопку разобрал модуль биржи');

  exchangeCalls.length = 0;
  await bot.handleUpdate({
    message: { chat: { id: 99, type: 'private' }, from: { id: 779 }, message_id: 4, text: '/outreach' },
  });
  assert.deepEqual(exchangeCalls, [], 'постороннему список не даём');
});

test('/limits показывает и норму Meta, и свой потолок', async () => {
  tg.clear();
  await say('/limits');
  const text = tg.sent.join('\n');
  assert.match(text, /4 из 100/, 'числа от самой Meta');
  assert.match(text, /не больше 10 публикаций за сутки/, 'свой потолок');
  assert.match(text, /Платная реклама по \/ad идёт сверх/);
  assert.match(text, /Сутки скользящие/);
});

test('/stats не падает и называет остаток нормы разбора', async () => {
  tg.clear();
  await say('/stats');
  const text = tg.sent.join('\n');
  assert.match(text, /Сегодня опубликовано: 0/);
  assert.match(text, /Разборов/);
  assert.match(text, /Публикаций в Instagram за сутки/);
});

test('чужому боту не отвечает ничем, кроме его же ID', async () => {
  tg.clear();
  await bot.handleUpdate({
    message: { chat: { id: 99, type: 'private' }, from: { id: 777 }, message_id: 2, text: '/stats' },
  });
  assert.equal(tg.sent.length, 1);
  assert.match(tg.sent[0], /только для администраторов/);
  assert.match(tg.sent[0], /Подписаться на новые вакансии — \/start/);
});

// Бот открыт всем ради подписки — завалить его сообщениями нельзя: сверх
// десяти в минуту посторонний не получает ответа (см. src/telegram/throttle.js).
// Админа норма не касается.
test('посторонний не может завалить бота, админ — может писать сколько угодно', async () => {
  tg.clear();
  for (let i = 0; i < 15; i += 1) {
    await bot.handleUpdate({
      message: { chat: { id: 888, type: 'private' }, from: { id: 888 }, message_id: 10 + i, text: '/products' },
    });
  }
  assert.equal(tg.sent.length, 10, tg.sent.join('\n'));
  assert.ok(tg.sent.every((t) => /только для администраторов/.test(t)), 'к продуктам посторонний не попал');

  tg.clear();
  for (let i = 0; i < 12; i += 1) await say('/help');
  assert.ok(tg.sent.length >= 12, 'админу норма не мешает');
});

// Подписка на вакансии (см. src/telegram/subscriptions.js) — публичная часть
// бота: /start постороннего уходит ей, а админу /start по-прежнему даёт справку.
test('/start чужого — подписке, админа — справка', async () => {
  tg.clear();
  subscriptions.calls.length = 0;
  await bot.handleUpdate({
    message: { chat: { id: 99, type: 'private' }, from: { id: 777 }, message_id: 3, text: '/start' },
  });
  assert.equal(tg.sent.length, 0, 'ответила подписка, а не бот');
  assert.deepEqual(subscriptions.calls.at(-1), { text: '/start', admin: false });

  await say('/start');
  assert.deepEqual(subscriptions.calls.at(-1), { text: '/start', admin: true });
  assert.ok(tg.sent.length > 0, 'админу — справка');

  tg.clear();
  await bot.handleUpdate({
    callback_query: { id: 'q', data: 'sub:obshchepit', from: { id: 777 }, message: { chat: { id: 99 }, message_id: 5 } },
  });
  assert.deepEqual(subscriptions.calls.at(-1), { data: 'sub:obshchepit' }, 'кнопку подписки жмёт кто угодно');
  assert.equal(tg.sent.length, 0);
});

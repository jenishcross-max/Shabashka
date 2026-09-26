// Платная реклама: она не должна пропасть ни при каких обстоятельствах.
//
// Отсюда три правила, которые и проверяются ниже. Реклама разбирается вне
// очереди; упёршись в лимиты модели, она откладывается, а не теряется, и её
// можно выложить кнопкой, не дожидаясь; а если лимиты так и не отпустили за все
// заходы — она выходит как есть, без разбора. Заплачено за публикацию, а не за
// разбор.
//
// И отдельно — то, из-за чего всё это однажды не сработало: отложенное жило
// только в памяти процесса, Render перезапустился, и объявление исчезло молча.
// Теперь оно лежит в базе (см. src/telegram/deferred.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at, chat } = require('./helpers/stub');

// Час ожидания превращается в доли секунды: проверяем поведение, а не сроки.
const realSetTimeout = global.setTimeout;
const realWait = (ms) => new Promise((r) => realSetTimeout(r, ms));
global.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 1000 ? Math.round(ms / 20000) : ms, ...rest);

process.env.TELEGRAM_CHANNEL_ID = '@shabashka';
process.env.PUBLIC_URL = 'https://xn--80aaac0cyed.com';

const tg = chat();
const published = [];
// Вместо базы — список строк в памяти: проверяем, что бот пишет и убирает
// отложенное, а не то, как это делает Postgres.
const rows = [];
let rowSeq = 0;
let parse = async () => [];

const requireSrc = install({
  [at('telegram/api.js')]: tg.api,
  [at('telegram/notify.js')]: { ADMIN_IDS: new Set(['1']), isAllowed: () => true, notifyAdmins: async () => {} },
  [at('telegram/extract.js')]: {
    usage: () => ({ tokens: 1000, calls: 1, limit: 200000, keys: 1, left: 199000, reserve: 40000 }),
    PACE_MS: 35000,
    KEY_COUNT: 1,
    hasPhone: () => true,
    phoneFrom: () => '+996500160633',
    fromText: (...args) => parse(...args),
  },
  [at('telegram/imports.js')]: {
    countToday: async () => 0,
    create: async ({ parsed }) => {
      published.push(parsed.title);
      return 7;
    },
    get: async () => null,
    reject: async () => {},
    remove: async () => {},
    applyDefaults: async (parsed) => ({ parsed, filled: [] }),
    setParsed: async () => {},
    setPosts: async () => {},
    publish: async () => ({ type: 'board', id: 55 }),
    setCard: async () => {},
  },
  [at('telegram/deferred.js')]: {
    add: async (row) => {
      const id = (rowSeq += 1);
      rows.push({ id, ...row });
      return id;
    },
    remove: async (id) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i !== -1) rows.splice(i, 1);
    },
    restorable: async () => rows.map((r) => ({ ...r })),
  },
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
    quota: { used: () => 0, dailyLimit: () => 8, hardLimit: () => 10, RESERVE: 2, adLimit: () => 100 },
    shareListing: async () => ({ skipped: [] }),
    shareMedia: () => ({ skipped: [], done: Promise.resolve(null) }),
    unpublish: async () => ({ threads: null, instagram: null }),
    adTracker: {
      WARN_AFTER_MS: 6 * 3600 * 1000,
      REPORT_AFTER_MS: 24 * 3600 * 1000,
      GOAL: 1000,
      MAX_BOOSTS: 2,
      start: () => {},
      track: async () => 1,
      addPost: async () => 1,
    },
    leads: { start: () => {} },
    adLine: () => '📣 Реклама',
    threadsConfigured: () => false,
  },
  [at('digestRepo.js')]: { SIZE: 5, DAYS: 2 },
});

const bot = requireSrc('telegram/bot.js');

let messageId = 10;
const say = (text) =>
  bot.handleUpdate({
    message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, message_id: (messageId += 1), text },
  });
const press = (data) =>
  bot.handleUpdate({
    callback_query: { id: 'q', data, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 99 } },
  });

const reset = () => {
  tg.clear();
  published.length = 0;
  rows.length = 0;
};

const AD = '/ad Требуются раннеры на ночную смену, 1500 сом за смену. Ватс ап 0500 16 06 33';

const limited = async () => {
  const err = new Error('суточная норма разбора на исходе');
  err.rateLimited = true;
  err.retryAt = Date.now() + 60 * 60 * 1000;
  throw err;
};

test('упёршись в лимит, реклама откладывается, попадает в базу и выходит по кнопке', async () => {
  reset();
  parse = limited;
  await say(AD);
  await realWait(40);

  assert.ok(tg.has(/Лимиты разбора выбраны/), tg.dump());
  assert.ok(tg.has(/кнопка выложит рекламу сразу/), 'ждать не обязательно — есть кнопка');
  assert.equal(published.length, 0, 'пока ничего не опубликовано');
  assert.equal(rows.length, 1, 'отложенное записано в базу — переживёт перезапуск');
  assert.equal(rows[0].ad, true);
  assert.match(rows[0].text, /раннеры/);

  // Ключ кнопки и номер строки растут вместе: и то и другое заводится в одном
  // месте, когда объявление откладывают.
  await press(`an:${rows[0].id}`);
  await realWait(60);

  assert.ok(tg.has(/Реклама, контент выложен как есть/), tg.dump());
  assert.equal(published.length, 1, 'объявление вышло');
  assert.equal(rows.length, 0, 'и больше не воскреснет после перезапуска');
});

test('если лимиты так и не отпустили, реклама выходит как есть — за неё заплачено', async () => {
  reset();
  parse = limited;
  await say(AD);
  await realWait(1500);

  assert.ok(tg.has(/Лимиты разбора так и не отпустили/), tg.dump());
  assert.equal(published.length, 1, 'вышла ровно один раз');
  assert.equal(rows.length, 0, 'строка в базе за собой не осталась');
});

test('обычное объявление в той же ситуации откладывается, но без кнопки и без базы', async () => {
  reset();
  parse = limited;
  await say('Нужен сантехник поменять кран в квартире, 0700111222');
  await realWait(40);

  assert.ok(tg.has(/Лимиты разбора выбраны/), tg.dump());
  assert.ok(!tg.has(/кнопка выложит рекламу сразу/), 'кнопка — только у рекламы');
  assert.equal(rows.length, 0, 'ради обычного объявления базу не трогаем');
});

test('работа за границей не выходит и за деньги', async () => {
  reset();
  parse = async () => {
    throw new Error('до модели дело не дошло');
  };
  await say('/ad Работа в Корее, зарплата 2000$, билет оплачиваем. 0500160633');
  await realWait(40);

  assert.ok(tg.has(/Шабашка выкладывает только работу в Кыргызстане/), tg.dump());
  assert.equal(published.length, 0, 'ни разбором, ни «как есть»');
});

test('после перезапуска отложенная реклама возвращается и доходит до публикации', async () => {
  reset();
  // Строка осталась от прошлого процесса: текст есть, разбора нет.
  rows.push({
    id: (rowSeq += 1),
    chatId: 1,
    messageId: 42,
    text: 'Требуются официанты в кофейню, 1200 сом за смену. Ватс ап 0500 16 06 33',
    ad: true,
    attempt: 0,
    retryAt: Date.now() + 60 * 1000,
  });

  const restored = await bot.restoreDeferred();
  assert.equal(restored, 1);
  assert.ok(tg.has(/Сервер перезапускался/), tg.dump());

  // Лимит к этому моменту отпустил — объявление разбирается и выходит.
  parse = async () => [
    {
      is_listing: true,
      listing_type: 'vacancy',
      title: 'Официанты в кофейню',
      description: 'Смена 12 часов',
      city: 'Бишкек',
      category: 'Другое',
      phone: '+996500160633',
      note: '',
      abroad: false,
    },
  ];
  await realWait(200);

  assert.equal(published.at(-1), 'Официанты в кофейню', 'объявление всё-таки вышло');
  assert.equal(rows.length, 0, 'и строка убрана — второй раз не выйдет');
});

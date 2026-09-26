// Бот и реклама в Threads: кампания заводится по опубликованному посту,
// кнопка «поднять» выкладывает рекламу ещё раз тем же файлом, отчёт через
// сутки читается человеком и годится для пересылки рекламодателю, /ads и
// /threads отвечают числами (см. src/telegram/bot.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at, chat } = require('./helpers/stub');

const tg = chat();
tg.api.downloadFile = async (fileId) => Buffer.from(`файл ${fileId}`);

let threadsHandler = null;
const tracked = [];
const added = [];
const boosted = [];
let campaign = null;

const HOUR = 3600 * 1000;

const tracker = {
  WARN_AFTER_MS: 6 * HOUR,
  REPORT_AFTER_MS: 24 * HOUR,
  GOAL: 1000,
  MAX_BOOSTS: 2,
  start: () => {},
  track: async (args) => {
    tracked.push(args);
    return 1;
  },
  addPost: async (id, postId) => added.push({ id, postId }),
  get: async () => campaign,
  canBoost: async () => true,
  postsOf: async () => [{ views: 640, permalink: 'https://www.threads.com/@shabashka.com_/post/abc' }],
  totalsOf: (posts) => ({
    views: posts.reduce((n, p) => n + p.views, 0),
    likes: 0,
    replies: 0,
    reposts: 0,
    quotes: 0,
    shares: 0,
    posts: posts.length,
    boosts: posts.length - 1,
  }),
  refresh: async () => {
    const posts = [
      { views: 1100, likes: 12, replies: 3, reposts: 2, quotes: 0, permalink: 'https://www.threads.com/p/1' },
      { views: 742, likes: 5, replies: 1, reposts: 0, quotes: 1, permalink: null },
    ];
    return {
      posts,
      totals: { views: 1842, likes: 17, replies: 4, reposts: 2, quotes: 1, shares: 0, posts: 2, boosts: 1 },
    };
  },
  recent: async () => (campaign ? [campaign] : []),
  summary: async () => ({ reported: 4, met: 3 }),
  ageOf: (c) => Date.now() - new Date(c.created_at).getTime(),
};

const requireSrc = install({
  [at('telegram/api.js')]: tg.api,
  [at('telegram/notify.js')]: {
    ADMIN_IDS: new Set(['1']),
    isAllowed: (id) => String(id) === '1',
    notifyAdmins: async (text) => tg.api.sendMessage(1, text),
  },
  [at('telegram/extract.js')]: {
    usage: () => ({ tokens: 0, calls: 0, keys: 1, models: [] }),
    PACE_MS: 35000,
    KEY_COUNT: 1,
    hasPhone: () => true,
    phoneFrom: () => null,
    fromText: async () => [],
  },
  [at('telegram/imports.js')]: {
    countToday: async () => 0,
    countThreadsPosts: async () => 400,
    get: async () => null,
    setPosts: async () => {},
  },
  [at('telegram/deferred.js')]: { add: async () => 1, remove: async () => {}, restorable: async () => [] },
  [at('social/index.js')]: {
    onThreads: (fn) => {
      threadsHandler = fn;
    },
    onReel: () => {},
    BATCH_SIZE: 3,
    RELEASE_INTERVAL_MIN: 150,
    THREADS_INTERVAL_MIN: 10,
    pending: () => 0,
    queuedByType: () => [],
    threadsQueued: () => 0,
    syncQuota: async () => {},
    quota: { used: () => 0, dailyLimit: () => 8, hardLimit: () => 10, RESERVE: 2, adLimit: () => 100 },
    adTracker: tracker,
    leads: { start: () => {} },
    adLine: () => '📣 Реклама',
    threadsConfigured: () => true,
    isPermissionError: () => false,
    accountInsights: async ({ since, until }) =>
      until - since > 2 * 24 * 3600
        ? { views: 455000, likes: 1400, replies: 300, reposts: 40, quotes: 10, followers: 3768 }
        : { views: 65400, likes: 210, replies: 40, reposts: 5, quotes: 1, followers: 3768 },
    postToThreads: (item, title, ctx) => {
      boosted.push({ item, title, ctx });
      return 1;
    },
  },
  [at('digestRepo.js')]: { SIZE: 5, DAYS: 2 },
});

const bot = requireSrc('telegram/bot.js');

const say = (text) =>
  bot.handleUpdate({ message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, message_id: 1, text } });
const press = (data) =>
  bot.handleUpdate({
    callback_query: { id: 'q', data, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 99 } },
  });
const settle = () => new Promise((r) => setTimeout(r, 30));

test('опубликованная реклама заводит кампанию — со всем, что нужно для повтора', async () => {
  tg.clear();
  await threadsHandler({
    posted: true,
    id: 'th-1',
    title: 'Требуются бариста',
    text: '📣 Реклама\n💼 Вакансия: бариста',
    ctx: { chatId: 1, importId: 5, ad: true, adMedia: { kind: 'image', fileId: 'f-1' } },
  });
  assert.equal(tracked.length, 1);
  assert.deepEqual(
    { ...tracked[0] },
    {
      chatId: 1,
      importId: 5,
      title: 'Требуются бариста',
      threadsText: '📣 Реклама\n💼 Вакансия: бариста',
      media: { kind: 'image', fileId: 'f-1' },
      card: null,
      postId: 'th-1',
    }
  );
  assert.ok(tg.has(/Слежу за просмотрами/), tg.dump());
});

test('обычное объявление кампанию не заводит', async () => {
  await threadsHandler({ posted: true, id: 'th-2', title: 'Сантехник', text: 'т', ctx: { chatId: 1 } });
  assert.equal(tracked.length, 1);
});

test('повтор добавляется к своей кампании, а не заводит новую', async () => {
  await threadsHandler({ posted: true, id: 'th-3', title: 'Бариста', text: 'т', ctx: { chatId: 1, campaignId: 7, ad: true } });
  assert.deepEqual(added.at(-1), { id: 7, postId: 'th-3' });
  assert.equal(tracked.length, 1);
});

test('кнопка «поднять» выкладывает рекламу тем же файлом из Telegram', async () => {
  tg.clear();
  campaign = {
    id: 7,
    chat_id: 1,
    title: 'Требуются бариста',
    threads_text: '📣 Реклама\n💼 Вакансия: бариста',
    media_kind: 'image',
    media_file_id: 'f-1',
    card: null,
    goal: 1000,
    created_at: new Date(Date.now() - 7 * HOUR),
  };
  await press('ab:7');
  await settle();
  const [boost] = boosted;
  assert.ok(boost, 'повтор ушёл');
  assert.equal(boost.item.media.kind, 'image');
  assert.equal(String(boost.item.media.buffer), 'файл f-1', 'файл скачан заново по file_id');
  assert.equal(boost.item.text, campaign.threads_text);
  assert.equal(boost.ctx.campaignId, 7);
  assert.ok(tg.has(/Поднимаю «Требуются бариста» в Threads/), tg.dump());
});

test('отчёт по кнопке — числа, гарантия и ссылка, годится для пересылки', async () => {
  tg.clear();
  campaign.created_at = new Date(Date.now() - 25 * HOUR);
  await press('ar:7');
  await settle();
  const report = tg.sent.at(-1);
  assert.match(report, /Отчёт по рекламе в Threads/);
  assert.match(report, /«Требуются бариста»/);
  assert.match(report, /1\s842 просмотра/);
  assert.match(report, /Постов: 2 \(повторов: 1\)/);
  assert.match(report, /✅ Гарантия 1\s000\+ просмотров за сутки выполнена/);
  assert.match(report, /<a href="https:\/\/www\.threads\.com\/p\/1">Пост в Threads<\/a>/);
});

test('/ads — список рекламы с кнопками отчёта', async () => {
  tg.clear();
  await say('/ads');
  assert.match(tg.sent.at(-1), /Реклама в Threads за 3 дня/);
  assert.match(tg.sent.at(-1), /«Требуются бариста» — 👁 1\s842/);
});

test('/threads — статистика для тех, кто спрашивает про рекламу', async () => {
  tg.clear();
  await say('/threads');
  const text = tg.sent.at(-1);
  assert.match(text, /За сутки: 👁 65\s400/);
  assert.match(text, /За 7 дней: 👁 455\s000/);
  assert.match(text, /Подписчиков: 3\s768/);
  assert.match(text, /В среднем на пост за неделю: ≈1\s138 \(400 постов\)/);
  assert.match(text, /Реклама за неделю: 4, гарантию набрали 3/);
});

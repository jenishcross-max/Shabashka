// Бот и реклама в Threads: кампания заводится по опубликованному посту,
// кнопка «поднять» выкладывает рекламу ещё раз тем же файлом, отчёт через
// сутки читается человеком и годится для пересылки рекламодателю, /ads и
// /threads отвечают числами (см. src/telegram/bot.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, dmStub, statsStub, at, chat, adGroupsStub, productStoreStub } = require('./helpers/stub');

const tg = chat();
const stats = statsStub();
tg.api.downloadFile = async (fileId) => Buffer.from(`файл ${fileId}`);

let threadsHandler = null;
const tracked = [];
const added = [];
const boosted = [];
let campaign = null;

const HOUR = 3600 * 1000;

// Реклама на сайте (imported_listings) — для меню «📣 Реклама».
const adRow = {
  id: 5,
  parsed: { title: 'Требуются бариста', for_students: true },
  status: 'published',
  vacancy_id: 31,
  channel_message_id: 77,
  is_ad: true,
  created_at: new Date(Date.now() - 3 * HOUR),
  published_at: new Date(Date.now() - 3 * HOUR),
};
// Что бот поправил в сообщении меню: разделы открываются на месте.
const edits = [];
tg.api.editMessageText = async (chatId, messageId, text, extra) => {
  edits.push({ messageId, text: String(text), extra });
};
const buttonsOf = (view) => view.extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);

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
  byImport: async (id) => (id === 5 ? campaign : null),
  summary: async () => ({ reported: 4, met: 3 }),
  ageOf: (c) => Date.now() - new Date(c.created_at).getTime(),
};

const groups = adGroupsStub();

const requireSrc = install({
  [at('telegram/adGroups.js')]: groups,
  [at('telegram/productStore.js')]: productStoreStub(),
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
    countThreadsPosts: async () => 400,
    get: async (id) => (id === 5 ? adRow : null),
    setPosts: async () => {},
    countAds: async () => 8,
    listAds: async ({ limit, offset }) =>
      offset === 0
        ? [
            {
              ...adRow,
              campaign_id: 7,
              goal: 1000,
              reported_at: null,
              views: 640,
              posts: 2,
              groups_sent: 1,
              groups_total: 2,
            },
            {
              id: 6,
              parsed: { title: 'Сдаю офис' },
              status: 'rejected',
              created_at: new Date(),
              published_at: new Date(),
              views: 0,
              groups_total: 0,
            },
          ].slice(0, limit)
        : [
            {
              id: 9,
              parsed: { title: 'Старая реклама' },
              status: 'published',
              created_at: new Date(Date.now() - 5 * 24 * HOUR),
              published_at: new Date(Date.now() - 5 * 24 * HOUR),
              views: 0,
              groups_total: 0,
            },
          ],
  },
  [at('telegram/deferred.js')]: { add: async () => 1, remove: async () => {}, restorable: async () => [] },
  // Директ ходит в базу — боту в этих тестах он не нужен.
  [at('dm/index.js')]: dmStub(),
  // Счётчики сводки и чёрный список номеров — тоже база.
  [at('telegram/feedStats.js')]: stats.feedStats,
  [at('telegram/blocklist.js')]: stats.blocklist,
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

test('/ads — вся реклама, сначала новая, с кнопкой «ℹ️» у каждой', async () => {
  tg.clear();
  await say('/ads');
  const text = tg.sent.at(-1);
  assert.match(text, /Реклама<\/b> — сначала новая · всего 8/);
  assert.match(text, /Страница 1 из 2/);
  assert.match(text, /1\. «Требуются бариста» · 3 ч назад/);
  // Числа освежены у Threads, а не взяты из базы (640).
  assert.match(text, /🧵 👁 1\s842 из 1\s000 ✅ · 👥 1 из 2/);
  assert.match(text, /2\. «Сдаю офис» · только что · 🗑 снята/);
  assert.match(text, /в Threads ещё не выходила/);
});

test('список листается, «ℹ️» открывает рекламу на месте', async () => {
  edits.length = 0;
  await press('al:1');
  assert.match(edits.at(-1).text, /7\. «Старая реклама»/, 'нумерация продолжается со второй страницы');
  assert.ok(buttonsOf(edits.at(-1)).includes('al:0'), 'и назад, к новым');

  // Кампания 7 только что поднималась кнопкой (тест выше), и «Поднять» у неё
  // справедливо спрятано. Здесь — свежая.
  campaign = { ...campaign, id: 8, created_at: new Date(Date.now() - 3 * HOUR), reported_at: null };
  groups.forImport = async () => [
    { status: 'sent', title: 'Работа Бишкек', target: '@rabota', link: 'https://t.me/rabota/15', sent_at: new Date(), views: null },
    { status: 'failed', title: 'Жумуш КГ', target: '@jumush', note: 'писать могут только админы или аккаунт не вступил в группу' },
    { status: 'pending', title: 'Вакансии', target: '@vac', not_before: new Date(Date.now() + 10 * 60 * 1000) },
  ];
  groups.channelViews = async (channel, id) => (id === 77 ? 340 : null);
  await press('ai:5:0');
  const info = edits.at(-1);
  assert.equal(info.messageId, 99, 'в том же сообщении');
  assert.match(info.text, /<b>Требуются бариста<\/b>/);
  assert.match(info.text, /💼 Вакансия на сайте/);
  assert.match(info.text, /🎓 Для студентов/);
  assert.match(info.text, /👁 1\s842 из 1\s000 ▰▰▰▰▰▰▰▰▰▰ ✅/);
  assert.match(info.text, /❤️ 17 · 💬 4 · 🔁 3/);
  assert.match(
    info.text,
    /<a href="https:\/\/www\.threads\.com\/p\/1">первый пост<\/a> — 👁 1\s100 · повтор 1 — 👁 742/
  );
  assert.match(info.text, /Отчёт за сутки — через 21 ч/);
  assert.match(info.text, /📢 Наш канал: 👁 340 просмотров/);
  assert.match(info.text, /Группы Telegram<\/b> — 1 из 3/);
  assert.match(info.text, /✅ <a href="https:\/\/t\.me\/rabota\/15">Работа Бишкек<\/a>/);
  assert.match(info.text, /⚠️ Жумуш КГ — писать могут только админы/);
  assert.match(info.text, /⏳ Вакансии · ≈/);
  assert.match(info.text, /Просмотры в группах Telegram не считает/);
  const buttons = buttonsOf(info);
  for (const data of ['ai:5:0:f', 'ib:8:5:0', 'ar:8', 'ax:5:0', 'al:0', 'm:home']) {
    assert.ok(buttons.includes(data), `кнопка ${data}: ${buttons.join(', ')}`);
  }
});

test('«Поднять» из карточки поднимает один раз и прячет кнопку', async () => {
  boosted.length = 0;
  edits.length = 0;
  await press('ib:8:5:0');
  await settle();
  assert.equal(boosted.length, 1);
  assert.ok(!buttonsOf(edits.at(-1)).includes('ib:8:5:0'), 'второй раз нажать нечего');
  // И «Обновить», пока повтор ждёт очереди Threads, кнопку не возвращает.
  await press('ai:5:0:f');
  assert.ok(!buttonsOf(edits.at(-1)).includes('ib:8:5:0'));
});

test('«Снять» сначала спрашивает', async () => {
  edits.length = 0;
  await press('ax:5:0');
  assert.match(edits.at(-1).text, /Снять рекламу «Требуются бариста»\?/);
  assert.match(edits.at(-1).text, /из групп Telegram/);
  assert.deepEqual(buttonsOf(edits.at(-1)), ['del:5', 'ai:5:0']);
});

test('меню: /menu, кнопки внизу экрана и разделы на месте', async () => {
  tg.clear();
  edits.length = 0;
  await say('/menu');
  assert.match(tg.sent[0], /Меню<\/b>/);
  assert.ok(tg.has(/Внизу экрана — кнопки/), 'кнопки внизу показаны');

  groups.overview = async () => ({
    enabled: true,
    connected: true,
    account: { id: '1', name: 'Шабашка', username: 'shabashka_admin' },
    separate: false,
    restrictedUntil: null,
    groups: [
      { target: '@rabota', title: 'Работа Бишкек', off: false, broken: null, lastSent: new Date(Date.now() - 2 * HOUR), pending: 0, week: 4 },
      { target: '@jumush', title: 'Жумуш КГ', off: false, broken: { reason: 'аккаунт заблокирован в этой группе', at: Date.now() }, pending: 0, week: 0 },
      { target: '@vac', title: 'Вакансии', off: true, broken: null, pending: 0, week: 0 },
    ],
    gapSec: 40,
    cooldownMin: 60,
    brokenHours: 24,
  });
  await press('m:groups');
  const view = edits.at(-1);
  assert.match(view.text, /Рассылка: ✅ включена/);
  assert.match(view.text, /Пишу от: Шабашка \(@shabashka_admin\) — тот же аккаунт, что читает группы/);
  assert.match(view.text, /1\. ✅ Работа Бишкек — последняя реклама 2 ч назад · за неделю 4/);
  assert.match(view.text, /2\. ⚠️ Жумуш КГ — аккаунт заблокирован в этой группе\. Попробую снова/);
  assert.match(view.text, /3\. ⏸ Вакансии — выключена/);
  assert.deepEqual(buttonsOf(view), ['ge:0', 'gt:0', 'gt:1', 'gt:2', 'm:groups', 'm:home']);

  const toggled = [];
  groups.toggle = async (i) => {
    toggled.push(i);
    return { target: '@vac', on: true };
  };
  await press('gt:2');
  assert.deepEqual(toggled, ['2']);

  tg.clear();
  await say('📣 Реклама');
  assert.match(tg.sent.at(-1), /сначала новая/, 'кнопка внизу экрана открывает список рекламы');
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

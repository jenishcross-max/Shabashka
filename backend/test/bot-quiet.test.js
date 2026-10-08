// Посты из групп бот публикует молча: на сайт, в канал и на площадки они уходят
// как раньше, но в чат админа — ни карточки, ни расписки площадок, ни отчётов
// Threads и Instagram. Вместо этого счётчики для сводки, а снять лишнее можно
// из /last (см. isQuiet и publishedView в src/telegram/bot.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, dmStub, statsStub, at, chat, adGroupsStub, adRaisesStub, productStoreStub } = require('./helpers/stub');

process.env.TELEGRAM_CHANNEL_ID = '@shabashka';
process.env.PUBLIC_URL = 'https://xn--80aaac0cyed.com';
delete process.env.SOURCE_REPORTS;

const tg = chat();
const stats = statsStub();
// Куда что ушло: в чат админа (1) или в канал.
const byChat = [];
tg.api.sendMessage = async (chatId, text, extra) => {
  byChat.push({ chatId: String(chatId), text: String(text), extra });
  tg.sent.push(String(text));
  return { message_id: 100 + byChat.length };
};
tg.api.editMessageText = async (chatId, messageId, text) => {
  byChat.push({ chatId: String(chatId), text: String(text), edited: true });
};

const parses = [];
let threadsHandler = null;
let reelHandler = null;
const shared = [];
const removed = [];
let rows = new Map();
let importSeq = 0;

// Как imports.listPublished: вкладка «из групп», «мои» или всё, сначала новое.
const published = (from) =>
  [...rows.values()]
    .filter((r) => r.status === 'published')
    .filter((r) => from === 'all' || (from === 'mine' ? r.source !== 'channel' : r.source === 'channel'))
    .reverse()
    .map((r) => ({ ...r, live: true }));

const groups = adGroupsStub();
const raises = adRaisesStub();

const requireSrc = install({
  [at('telegram/adGroups.js')]: groups,
  [at('telegram/productStore.js')]: productStoreStub(),
  [at('telegram/adRaises.js')]: raises,
  [at('telegram/api.js')]: tg.api,
  [at('telegram/notify.js')]: { ADMIN_IDS: new Set(['1']), isAllowed: () => true, notifyAdmins: async () => {} },
  [at('telegram/extract.js')]: {
    usage: () => ({ tokens: 0, calls: 0, keys: 1, models: [] }),
    PACE_MS: 35000,
    KEY_COUNT: 1,
    hasPhone: () => true,
    phoneFrom: () => null,
    fromText: async (text, opts) => {
      parses.push({ text, opts });
      return [];
    },
  },
  [at('telegram/imports.js')]: {
    create: async ({ parsed, source }) => {
      const id = (importSeq += 1);
      rows.set(id, { id, parsed, source, status: 'pending', published_at: new Date(), board_post_id: 50 + id });
      return id;
    },
    get: async (id) => rows.get(id) || null,
    reject: async (id) => {
      if (rows.has(id)) rows.get(id).status = 'rejected';
    },
    remove: async (id) => {
      removed.push(id);
      rows.get(id).status = 'rejected';
    },
    applyDefaults: async (parsed) => ({ parsed, filled: [] }),
    setParsed: async () => {},
    setPosts: async () => {},
    setCard: async () => {},
    publish: async (id) => {
      rows.get(id).status = 'published';
      return { type: 'board', id: 50 + id };
    },
    listPublished: async ({ from }) => published(from),
    countPublished: async (from) => published(from).length,
  },
  [at('telegram/deferred.js')]: { add: async () => 1, remove: async () => {}, restorable: async () => [] },
  [at('dm/index.js')]: dmStub(),
  [at('telegram/feedStats.js')]: stats.feedStats,
  [at('telegram/blocklist.js')]: stats.blocklist,
  [at('social/index.js')]: {
    onThreads: (fn) => {
      threadsHandler = fn;
    },
    onReel: (fn) => {
      reelHandler = fn;
    },
    BATCH_SIZE: 3,
    RELEASE_INTERVAL_MIN: 150,
    THREADS_INTERVAL_MIN: 10,
    pending: () => 0,
    queuedByType: () => [],
    threadsQueued: () => 0,
    syncQuota: async () => {},
    collectionTitle: () => 'Объявления дня',
    quota: { used: () => 0, dailyLimit: () => 8, hardLimit: () => 10, RESERVE: 2, adLimit: () => 100 },
    shareListing: async (parsed, listingType, siteLink, ctx) => {
      shared.push({ parsed, ctx });
      return { skipped: [], threadsQueued: true, threadsWaiting: 1, queued: true, collection: 'Объявления дня', waiting: 1, releaseInMin: 150 };
    },
    unpublish: async () => ({ threads: { removed: true }, instagram: null }),
    adTracker: {
      WARN_AFTER_MS: 6 * 3600 * 1000,
      REPORT_AFTER_MS: 24 * 3600 * 1000,
      GOAL: 1000,
      MAX_BOOSTS: 2,
      start: () => {},
    },
    leads: { start: () => {} },
    adLine: () => '📣 Реклама',
    threadsConfigured: () => true,
  },
  [at('digestRepo.js')]: { SIZE: 5, DAYS: 2 },
});

const bot = requireSrc('telegram/bot.js');

const toAdmin = () => byChat.filter((m) => m.chatId === '1');
const toChannel = () => byChat.filter((m) => m.chatId === '@shabashka');
const settle = () => new Promise((r) => setTimeout(r, 20));
const listing = (title, phone) => ({
  is_listing: true,
  listing_type: 'board',
  title,
  description: `${title}, звоните`,
  phone,
  city: 'Бишкек',
});

test('пост из группы уходит на сайт, в канал и на площадки, а в чат — ни слова', async () => {
  byChat.length = 0;
  const published = await bot.ingestFromSource(1, [listing('Продаю диван', '+996700111222')], {
    source: 'channel',
    rawText: 'Продаю диван 0700111222',
  });
  await settle();
  assert.equal(published, 1);
  assert.equal(toAdmin().length, 0, `в чат ушло: ${toAdmin().map((m) => m.text).join(' | ')}`);
  assert.equal(toChannel().length, 1, 'в канал пост ушёл как обычно');
  assert.equal(shared.length, 1);
  assert.equal(shared[0].ctx.quiet, true, 'площадки знают, что отчитываться не надо');
  assert.equal(stats.counters['grp.ok.board'], 1, 'вышедшее посчитано для сводки');
});

test('повтор и пост без номера из группы тоже молча — только в счётчик', async () => {
  byChat.length = 0;
  await bot.ingestFromSource(1, [listing('Без номера', null)], { source: 'channel', rawText: 'Без номера' });
  assert.equal(toAdmin().length, 0);
  assert.equal(stats.counters['grp.nophone'], 1);
});

test('отчёты Threads и Instagram по постам из групп не приходят', async () => {
  byChat.length = 0;
  await threadsHandler({ posted: true, id: 'th-9', title: 'Продаю диван', ctx: { chatId: 1, importId: 1, quiet: true } });
  await reelHandler({
    instagram: { posted: true, id: 'ig-1' },
    items: [{ parsed: { title: 'Продаю диван' } }],
    collection: 'Объявления дня',
    contexts: [{ chatId: 1, importId: 1, quiet: true }],
  });
  assert.equal(toAdmin().length, 0, `в чат ушло: ${toAdmin().map((m) => m.text).join(' | ')}`);
  assert.equal(stats.counters['th.ok'], 1);
  assert.equal(stats.counters['ig.reel'], 1);
});

test('присланное админом — по-прежнему с карточкой и кнопкой «Спам»', async () => {
  byChat.length = 0;
  await bot.ingestFromSource(1, [listing('Продаю шкаф', '+996700333444')], { source: 'telegram', rawText: 'шкаф' });
  await settle();
  const card = toAdmin().find((m) => /Повесил на доску/.test(m.text));
  assert.ok(card, 'карточка пришла');
  const buttons = card.extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(buttons.some((d) => d.startsWith('del:')));
  assert.ok(buttons.some((d) => d.startsWith('spm:')), 'кнопка «Спам» есть');
  assert.equal(stats.counters['adm.ok'], 1);
});

test('/last показывает посты из групп, а 🚫 снимает и запоминает номер', async () => {
  byChat.length = 0;
  await bot.handleUpdate({ message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, message_id: 5, text: '/last' } });
  const list = toAdmin()[0];
  assert.match(list.text, /Продаю диван/);
  assert.doesNotMatch(list.text, /Продаю шкаф/, 'присланное админом в список из групп не попадает');
  const data = list.extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  const spamButton = data.find((d) => d.startsWith('lspm:'));
  assert.ok(spamButton);
  assert.ok(data.includes('lp:mine:0'), 'вкладка «Мои» — присланное вручную');

  byChat.length = 0;
  await bot.handleUpdate({
    callback_query: { id: 'q', data: 'lp:mine:0', from: { id: 1 }, message: { chat: { id: 1 }, message_id: 7 } },
  });
  const mine = toAdmin()[0];
  assert.ok(mine.edited, 'вкладка открывается в том же сообщении');
  assert.match(mine.text, /Продаю шкаф/);
  assert.doesNotMatch(mine.text, /Продаю диван/);

  byChat.length = 0;
  await bot.handleUpdate({
    callback_query: { id: 'q', data: spamButton, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 7 } },
  });
  assert.deepEqual(removed, [1]);
  assert.ok(stats.blocked.has('+996700111222'), 'номер в чёрном списке');
  const report = toAdmin().find((m) => /Номер \+996700111222/.test(m.text));
  assert.ok(report && !report.edited, 'отчёт отдельным сообщением — список остаётся');

  // Второе нажатие по уже снятому — без второго снятия.
  await bot.handleUpdate({
    callback_query: { id: 'q', data: spamButton, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 7 } },
  });
  assert.deepEqual(removed, [1]);
});

test('/stats собирает сводку из счётчиков', async () => {
  byChat.length = 0;
  await bot.handleUpdate({ message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, message_id: 6, text: '/stats' } });
  const text = toAdmin().map((m) => m.text).join('\n');
  assert.match(text, /Из групп/);
  assert.match(text, /Вышло: 1 — 💼 0 · 🧰 0 · 📌 1/);
  assert.match(text, /без номера 1/);
  assert.match(text, /Прислано вручную: 1/);
  assert.match(text, /Threads: 1/);
});

test('рекламу с оформлением на чужие документы не выкладывает и по /ad_fast', async () => {
  byChat.length = 0;
  await bot.handleUpdate({
    message: {
      chat: { id: 1, type: 'private' },
      from: { id: 1 },
      message_id: 8,
      text: '/ad_fast Нотариуска барып Китайдан келген машинага доверность жазыш керек. Загс барлар жарабайт. Акчасы дароо колго берилет 0700123456',
    },
  });
  const text = toAdmin().map((m) => m.text).join('\n');
  assert.match(text, /Не публикую: оформление/);
  assert.equal(toChannel().length, 0);
});

test('реклама с тремя вакансиями внутри в сводке — одна реклама', async () => {
  const before = stats.counters['ad.ok'] || 0;
  await bot.ingestFromSource(
    1,
    [listing('Бариста', '+996700100100'), listing('Повар', '+996700100100'), listing('Техничка', '+996700100100')],
    { source: 'telegram', rawText: 'кафе ищет', priority: true, ad: true }
  );
  await settle();
  assert.equal((stats.counters['ad.ok'] || 0) - before, 1);
});

test('/spam показывает отсеянное, а «✅ Не спам» снимает номер и разбирает пост заново без проверки на сетевое', async () => {
  const rejected = requireSrc('telegram/rejected.js');
  stats.blocked.add('+996700555666');
  rejected.add({
    text: 'Требуется помощник администратора в офис, карьерный рост, 0700555666',
    reason: 'сетевой маркетинг',
    phones: ['+996700555666'],
  });

  byChat.length = 0;
  await bot.handleUpdate({ message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, message_id: 9, text: '/spam' } });
  const list = toAdmin()[0];
  assert.match(list.text, /помощник администратора/);
  assert.match(list.text, /сетевой маркетинг/);
  const button = list.extra.reply_markup.inline_keyboard.flat()[0].callback_data;
  assert.match(button, /^ns:/);

  await bot.handleUpdate({
    callback_query: { id: 'q', data: button, from: { id: 1 }, message: { chat: { id: 1 }, message_id: 10 } },
  });
  await settle();
  assert.ok(!stats.blocked.has('+996700555666'), 'номер снят с чёрного списка');
  const parse = parses.find((p) => /помощник администратора/.test(p.text));
  assert.ok(parse, 'пост ушёл на разбор');
  assert.equal(parse.opts.trusted, true, 'без повторной проверки на сетевое');
  assert.equal(rejected.list().length, 0, 'из списка убран — второй раз не нажать');
});

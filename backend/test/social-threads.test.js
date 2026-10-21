// Что уходит в Threads (см. publishToThreads, shareListing и shareMedia в
// src/social/index.js). Рекламу у Шабашки заказывают именно в Threads, поэтому
// здесь проверяется то, за что платят: реклама выходит с пометкой и картинкой,
// файл рекламодателя — файлом, длинная подпись не отбивается лимитом в 500
// знаков, а сбой картинки не оставляет рекламу без поста вовсе. Обычные
// объявления при этом уходят, как и раньше, текстом.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');

process.env.RENDER_EXTERNAL_URL = 'https://shabashka.test';
process.env.INSTAGRAM_DAILY_LIMIT = '100';
delete process.env.THREADS_CARDS;
// Пометка рекламы по умолчанию выключена; здесь её включаем, чтобы проверить,
// что она встаёт первой строкой, когда её просят.
process.env.AD_LABEL = 'Реклама';
delete process.env.THREADS_TOPIC_TAG;

// Между постами в Threads десять минут — в тесте сжимаем.
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 1000 ? 2 : ms, ...rest);
const settle = () => new Promise((r) => realSetTimeout(r, 40));

const posted = [];
// Подписи роликов Instagram — отдельно: число постов в Threads тесты считают.
const reels = [];
let imageFails = false;

const requireSrc = install({
  [at('social/tokens.js')]: { get: () => 'токен', start: async () => {}, load: async () => {} },
  [at('social/adTracker.js')]: { start: () => {} },
  [at('social/leads.js')]: { start: () => {} },
  [at('social/threads.js')]: {
    isConfigured: () => true,
    isPermissionError: () => false,
    publishText: async (text, opts) => {
      posted.push({ kind: 'text', text, opts });
      return `t${posted.length}`;
    },
    publishImage: async (url, text, opts) => {
      if (imageFails) throw new Error('создание поста: изображение не скачалось');
      posted.push({ kind: 'image', url, text, opts });
      return `i${posted.length}`;
    },
    publishVideo: async (url, text, opts) => {
      posted.push({ kind: 'video', url, text, opts });
      return `v${posted.length}`;
    },
    publishCarousel: async (urls, text) => {
      posted.push({ kind: 'carousel', urls, text });
      return `c${posted.length}`;
    },
    publishingLimit: async () => ({ used: 0, total: 250 }),
  },
  [at('social/instagram.js')]: {
    isConfigured: () => true,
    publishReel: async (url, caption) => {
      reels.push(caption);
      return 'reel';
    },
    publishImage: async (url, caption) => {
      posted.push({ kind: 'ig-image', url, text: caption });
      return 'ig-image';
    },
    publishCarousel: async (urls, caption) => {
      posted.push({ kind: 'ig-carousel', urls, text: caption });
      return 'ig-carousel';
    },
    publishingLimit: async () => ({ used: 0, total: 100 }),
    permalink: async () => '',
  },
  [at('social/card.js')]: {
    renderStill: async () => Buffer.from('jpeg'),
    stillName: () => 'card.jpg',
    collectionTitle: () => 'Вакансия дня',
    dayLabel: () => '25 сентября',
    isStudentBatch: () => false,
    COVER_AT: 3.6,
  },
  [at('social/video.js')]: {
    ...require('../src/social/video'),
    build: async () => ({ buffer: Buffer.from('mp4'), credit: null }),
  },
});

const social = requireSrc('social/index.js');
const video = requireSrc('social/video.js');

const handled = [];
social.onThreads(async (result) => handled.push(result));

const parsed = {
  title: 'Требуются бариста',
  description: 'Кофейня в центре, смена 12 часов',
  category: 'Другое',
  city: 'Бишкек',
  budget: 1500,
  phone: '+996500160633',
};

test('обычное объявление уходит в Threads текстом, с тегом «шабашка» и без решёток', async () => {
  posted.length = 0;
  await social.shareListing(parsed, 'vacancy', 'шабашка.com/vacancies/1', { chatId: 1 }, {});
  await settle();
  const [post] = posted;
  assert.equal(post.kind, 'text');
  assert.equal(post.opts.topicTag, 'шабашка');
  assert.ok(!post.text.includes('#'), post.text);
  assert.ok(!post.text.includes('Реклама'));
  // Метка источника (см. src/sourceTag.js): по ней Метрика отличит Threads.
  assert.match(post.text, /\nшабашка\.com\/vacancies\/1\?s=t$/);
});

test('реклама — картинкой-карточкой, с пометкой, а в отчёт уходит всё для повтора', async () => {
  posted.length = 0;
  handled.length = 0;
  await social.shareListing(parsed, 'vacancy', 'шабашка.com/vacancies/2', { chatId: 1, importId: 5 }, { priority: true });
  await settle();
  const post = posted.find((p) => p.kind === 'image');
  assert.ok(post, 'реклама ушла картинкой');
  assert.match(post.url, /^https:\/\/shabashka\.test\/api\/social\/image\//);
  assert.match(post.text.split('\n')[0], /📣 Реклама/);
  const report = handled.at(-1);
  assert.equal(report.ctx.ad, true, 'отчёт знает, что это реклама');
  assert.equal(report.ctx.importId, 5);
  assert.deepEqual(report.ctx.card.parsed, parsed, 'по карточке повтор выйдет таким же постом');
  assert.equal(report.text, post.text);
});

test('не прошла картинка — реклама всё равно выходит, текстом', async () => {
  posted.length = 0;
  imageFails = true;
  await social.shareListing(parsed, 'vacancy', 'шабашка.com/vacancies/3', { chatId: 1 }, { priority: true });
  await settle();
  imageFails = false;
  assert.equal(posted.length, 1);
  assert.equal(posted[0].kind, 'text');
  assert.match(posted[0].text, /📣 Реклама/);
});

test('реклама с файлом уходит в Threads самим файлом, а подпись ужата до 500 знаков', async () => {
  posted.length = 0;
  const longText = 'Открылся новый салон красоты в центре города. '.repeat(40);
  const result = social.shareMedia(
    { kind: 'video', buffer: Buffer.from('mp4'), text: longText, siteLink: 'шабашка.com/board#p9', title: 'Салон' },
    { chatId: 1, adMedia: { kind: 'video', fileId: 'f-9' } },
    { priority: true }
  );
  await settle();
  const post = posted.find((p) => p.kind === 'video');
  assert.ok(post, 'в Threads ушёл ролик рекламодателя');
  assert.ok(social.adLine() && post.text.startsWith(social.adLine()));
  assert.match(post.text, /шабашка\.com\/board\?s=t#p9$/, 'ссылка на карточку сохранена целой, с меткой Threads');
  let weight = 0;
  for (const ch of post.text) weight += ch.codePointAt(0) > 0xffff ? Buffer.byteLength(ch) : 1;
  assert.ok(weight <= 500, `вес подписи ${weight}`);
  // В Instagram подпись длинная — там она влезает целиком.
  assert.ok(result.caption.includes(longText.trim()), 'в Instagram — вся подпись');
  assert.ok(result.caption.startsWith(social.adLine()));
  assert.deepEqual(handled.at(-1).ctx.adMedia, { kind: 'video', fileId: 'f-9' });
});

test('повтор рекламы кнопкой идёт только в Threads и с тем же постом', async () => {
  posted.length = 0;
  const waiting = social.postToThreads(
    { text: '📣 Реклама\nтекст', media: null, card: { parsed, listingType: 'vacancy' } },
    'Бариста',
    { chatId: 1, campaignId: 3, ad: true }
  );
  assert.ok(waiting >= 1);
  await settle();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].kind, 'image');
  assert.equal(handled.at(-1).ctx.campaignId, 3);
});

// Свои продукты (см. telegram/products.js): одно фото — картинкой, несколько —
// каруселью, без фото — в Threads текстом, а Instagram честно отказывает.
test('продукт: карусель на обе площадки, без фото — только Threads', async () => {
  posted.length = 0;
  const jpeg = (n) => Buffer.from(`jpeg${n}`);
  const both = await social.shareProduct({
    text: 'Свадебные пригласительные',
    threadsImages: [jpeg(1), jpeg(2)],
    instagramImages: [jpeg(1), jpeg(2)],
  });
  assert.equal(both.threads.posted, true);
  assert.equal(both.instagram.posted, true);
  const carousel = posted.find((p) => p.kind === 'carousel');
  assert.equal(carousel.text, 'Свадебные пригласительные');
  assert.equal(carousel.urls.length, 2);
  assert.match(carousel.urls[0], /^https:\/\/shabashka\.test\/api\/social\/image\//, 'фото выложены наружу для Meta');
  assert.ok(posted.some((p) => p.kind === 'ig-carousel'));

  posted.length = 0;
  const one = await social.shareProduct({ text: 'Scroll Book', threadsImages: [jpeg(1)], instagramImages: [jpeg(1)] });
  assert.deepEqual(posted.map((p) => p.kind).sort(), ['ig-image', 'image']);
  assert.equal(one.instagram.posted, true);

  posted.length = 0;
  const bare = await social.shareProduct({ text: 'Только текст' });
  assert.deepEqual(posted.map((p) => p.kind), ['text']);
  assert.equal(bare.instagram.posted, false);
  assert.match(bare.instagram.reason, /без фото/);
});

test('продукт с видео: ролик в Threads и Reels в Instagram, фото не нужны', async () => {
  posted.length = 0;
  reels.length = 0;
  const result = await social.shareProduct({ text: 'Биржа на шабашка.com', video: Buffer.from('mp4') });
  assert.equal(result.threads.posted, true);
  assert.equal(result.instagram.posted, true, result.instagram.reason);
  const clip = posted.find((p) => p.kind === 'video');
  assert.equal(clip.text, 'Биржа на шабашка.com');
  assert.match(clip.url, /^https:\/\/shabashka\.test\/api\/social\/video\/.+\.mp4$/);
  assert.deepEqual(reels, ['Биржа на шабашка.com']);
});

// Поднятие рекламы по расписанию (см. telegram/adRaises.js): тот же пост ещё
// раз. Файл рекламодателя — файлом, без файла — карточкой, и Instagram тоже
// получает картинку, а не отказ «нечего показать».
test('поднятие рекламы: файл — файлом, без файла — карточкой на обе площадки', async () => {
  posted.length = 0;
  const withFile = await social.raiseAd({
    text: 'Требуются бариста',
    threadsText: 'Требуются бариста — шабашка.com/vacancies/7',
    media: { kind: 'image', buffer: Buffer.from('макет') },
  });
  assert.equal(withFile.threads.posted, true);
  assert.equal(withFile.instagram.posted, true);
  assert.equal(posted.find((p) => p.kind === 'image').text, 'Требуются бариста — шабашка.com/vacancies/7');
  assert.ok(posted.some((p) => p.kind === 'ig-image'));

  posted.length = 0;
  const byCard = await social.raiseAd({ text: 'Нужен сантехник', card: { parsed, listingType: 'order' }, siteLink: 'шабашка.com/orders/3' });
  assert.equal(byCard.threads.posted, true);
  assert.equal(byCard.instagram.posted, true);
  assert.match(posted.find((p) => p.kind === 'image').text, /Нужен сантехник/, 'текст для Threads собран из рекламы');
  assert.match(posted.find((p) => p.kind === 'image').text, /шабашка\.com\/orders\/3\?s=t$/, 'в Threads — с меткой');
  assert.match(posted.find((p) => p.kind === 'ig-image').text, /шабашка\.com\/orders\/3/);

  const onlyThreads = await social.raiseAd({ text: 'Текст', instagram: false });
  assert.equal(onlyThreads.instagram, null, 'в Instagram не поднимали');
  const bare = await social.raiseAd({ text: 'Текст', threads: false });
  assert.equal(bare.threads, null);
  assert.match(bare.instagram.reason, /нечего показать/);
});

// Продукт — как платная реклама: в Threads встаёт перед обычными объявлениями
// (но за рекламой, вставшей раньше), а в Instagram идёт под потолком площадки,
// когда своя суточная норма уже выбрана роликами.
test('продукт идёт в очередях как реклама: перед объявлениями и сверх своей нормы', async () => {
  posted.length = 0;
  for (const n of [11, 12, 13]) social.shareListing(parsed, 'vacancy', `шабашка.com/vacancies/${n}`, { chatId: 1 }, {});
  social.postToThreads({ text: 'Повтор рекламы' }, 'Реклама', { chatId: 1, ad: true });
  const { quota } = social;
  while (quota.left()) quota.take();
  assert.equal(quota.take(), false, 'обычная норма Instagram выбрана');

  const done = social.shareProduct({ text: 'Scroll Book', instagramImages: [Buffer.from('jpeg')] });
  assert.equal(social.threadsQueued({ priority: true }), 2, 'впереди продукта только реклама');
  assert.equal(social.threadsQueued(), 5);
  const result = await done;
  await settle();

  assert.deepEqual(
    posted.filter((p) => p.kind === 'text' || p.kind === 'image').map((p) => p.text.split('\n')[0]).slice(0, 2),
    ['Повтор рекламы', 'Scroll Book'],
    'реклама, вставшая раньше, — первой, продукт — сразу за ней, объявления — потом'
  );
  assert.equal(result.instagram.posted, true, result.instagram.reason);
  assert.ok(posted.some((p) => p.kind === 'ig-image' && p.text === 'Scroll Book'));
});

// Зов подписаться (см. src/social/follow.js): у каждого четвёртого обычного
// поста, прямо перед ссылкой, и никогда — у рекламы.
test('каждый четвёртый пост-объявление зовёт подписаться, реклама — никогда', async () => {
  posted.length = 0;
  for (const n of [21, 22, 23, 24]) social.shareListing(parsed, 'vacancy', `шабашка.com/vacancies/${n}`, { chatId: 1 }, {});
  social.shareListing(parsed, 'vacancy', 'шабашка.com/vacancies/25', { chatId: 1 }, { priority: true });
  // Пять постов через очередь: ждём по условию, а не по часам — таймеры Windows грубые.
  // Считаем только свои: под нагрузкой полного прогона сюда доезжал хвост
  // очереди предыдущего теста, и «четыре обычных» превращались в пять.
  const mine = () => posted.filter((p) => /vacancies\/2[1-5]\b/.test(p.text));
  for (let i = 0; i < 50 && mine().length < 5; i += 1) await settle();
  const ad = mine().find((p) => /vacancies\/25/.test(p.text));
  const ordinary = mine().filter((p) => p !== ad);
  assert.equal(ordinary.length, 4);
  const withFollow = ordinary.filter((p) => p.text.includes('🔔 Подпишись'));
  assert.equal(withFollow.length, 1, 'ровно один из четырёх');
  assert.match(withFollow[0].text, /🔔 Подпишись[^\n]*\nшабашка\.com\/vacancies\/\d+\?s=t$/, 'строка — прямо перед ссылкой');
  assert.ok(!ad.text.includes('🔔'), 'у рекламы строки нет');

  const long = video.threadsText(
    { ...parsed, description: 'Очень длинное описание. '.repeat(60) },
    'vacancy',
    'шабашка.com/vacancies/9',
    { follow: '🔔 Подпишись — каждый день 60+ новых вакансий и подработок' }
  );
  assert.ok(video.weight(long) <= 500, `вес ${video.weight(long)}`);
  assert.match(long, /…\n\n🔔 Подпишись — каждый день 60\+[^\n]*\nшабашка\.com\/vacancies\/9$/);
});

// Повод зайти на сайт (исследование 18 октября 2026, см. docs/research): пост
// с номером самодостаточен, и из сотен просмотров на сайт переходили единицы.
// Последняя строка зовёт не на одну карточку, а ко всем вакансиям за сутки.
test('пост-объявление зовёт ко всем объявлениям за сутки, реклама — нет', async () => {
  const more = requireSrc('social/more.js');
  more.setCounts({ vacancy: 63, order: 18 });
  try {
    posted.length = 0;
    social.shareListing(parsed, 'vacancy', 'шабашка.com/vacancies/41', { chatId: 1 }, {});
    social.shareListing(parsed, 'order', 'шабашка.com/orders/42', { chatId: 1 }, {});
    social.shareListing(parsed, 'vacancy', 'шабашка.com/vacancies/43', { chatId: 1 }, { priority: true });
    for (let i = 0; i < 50 && posted.length < 3; i += 1) await settle();
    const textOf = (n) => posted.find((p) => p.text.includes(`/${n}`)).text;
    assert.match(textOf(41), /\nшабашка\.com\/vacancies\/41\?s=t\n👉 Все 63 вакансии за сутки — шабашка\.com\/vacancies\?s=t$/);
    assert.match(textOf(42), /\n👉 Все 18 подработок за сутки — шабашка\.com\/orders\?s=t$/);
    assert.ok(!textOf(43).includes('👉'), 'реклама зовёт только к себе');

    const long = video.threadsText(
      { ...parsed, description: 'Очень длинное описание. '.repeat(60) },
      'vacancy',
      'шабашка.com/vacancies/9',
      { follow: '🔔 Подпишись — каждый день 60+ новых вакансий и подработок', more: more.line('vacancy', 'шабашка.com/vacancies/9') }
    );
    assert.ok(video.weight(long) <= 500, `вес ${video.weight(long)}`);
    assert.match(long, /…\n\n🔔 Подпишись[^\n]*\nшабашка\.com\/vacancies\/9\n👉 Все 63 вакансии за сутки/);

    more.setCounts({ vacancy: 7, order: 0 });
    assert.equal(more.line('vacancy', 'шабашка.com/vacancies/9'), '', 'меньше десяти — не хвалимся');
    more.setCounts({ vacancy: 63 });
    assert.equal(more.line('board', 'шабашка.com/ads#p5'), '', 'у объявлений «сдам/продам» своего счёта нет');
    assert.equal(more.line('vacancy', ''), '', 'без ссылки звать некуда');
  } finally {
    more.setCounts({});
  }
});

// Подписка в бота (см. src/social/subLine.js): у части постов-вакансий с
// профессией — вместо «Все N за сутки», но не у рекламы и не рядом с «подпишись».
test('часть постов-вакансий зовёт подписаться на профессию в боте', async () => {
  const more = requireSrc('social/more.js');
  more.setCounts({ vacancy: 63 });
  try {
    posted.length = 0;
    const cafe = { ...parsed, category: 'Общепит' };
    for (const n of [51, 52, 53, 54, 55, 56]) social.shareListing(cafe, 'vacancy', `шабашка.com/vacancies/${n}`, { chatId: 1 }, {});
    social.shareListing(cafe, 'vacancy', 'шабашка.com/vacancies/57', { chatId: 1 }, { priority: true });
    const mine = () => posted.filter((p) => /vacancies\/5[1-7]\b/.test(p.text));
    for (let i = 0; i < 80 && mine().length < 7; i += 1) await settle();
    const ad = mine().find((p) => /vacancies\/57/.test(p.text));
    const ordinary = mine().filter((p) => p !== ad);
    assert.equal(ordinary.length, 6);

    const withSub = ordinary.filter((p) => p.text.includes('📲'));
    assert.ok(withSub.length >= 2, `строка подписки у ${withSub.length} из 6`);
    for (const p of withSub) {
      assert.match(p.text, /\nшабашка\.com\/vacancies\/5\d\?s=t\n📲 Новые вакансии «Общепит» — в Telegram: шабашка\.com\/s\/obshchepit$/);
      assert.ok(!p.text.includes('👉'), 'вместо «Все N за сутки», а не вдобавок');
      assert.ok(!p.text.includes('🔔'), 'не рядом с «подпишись»: два зова в одном посте спорят');
    }
    assert.ok(
      ordinary.filter((p) => !withSub.includes(p)).every((p) => p.text.includes('👉 Все 63 вакансии')),
      'у остальных — «Все N за сутки», как раньше'
    );
    assert.ok(!ad.text.includes('📲'), 'у рекламы строки нет');
  } finally {
    more.setCounts({});
  }
});

// Рубрика (см. telegram/rubrics.js): в Threads — как реклама, перед объявлениями;
// в Instagram — ролик без пометки рекламы, со строкой «подпишись».
test('рубрика встаёт перед объявлениями, а ролик уходит без пометки рекламы', async () => {
  posted.length = 0;
  reels.length = 0;
  for (const n of [31, 32]) social.shareListing(parsed, 'vacancy', `шабашка.com/vacancies/${n}`, { chatId: 1 }, {});
  const item = { id: 7, listingType: 'vacancy', parsed, siteLink: 'шабашка.com/vacancies/7' };
  const result = await social.shareRubric({
    text: '💰 Топ-3 вакансий дня по зарплате',
    items: [item, item, item],
    collection: 'Топ-3 по зарплате',
    cta: 'все вакансии — на сайте',
  });
  for (let i = 0; i < 50 && posted.length < 3; i += 1) await settle();

  assert.equal(result.threads.posted, true);
  assert.equal(posted[0].text, '💰 Топ-3 вакансий дня по зарплате', 'рубрика — первой, как реклама');
  assert.equal(result.instagram.posted, true, result.instagram.reason);
  const [caption] = reels;
  assert.match(caption, /^📋 Топ-3 по зарплате/);
  assert.doesNotMatch(caption, /Реклама/, 'это наша подборка, не реклама');
  assert.match(caption, /🔔 Подпишись/);
  assert.match(caption, /\n🧵 [^\n]*Threads: @shabashka\.com_\n/, 'из Instagram зовём и в Threads');

  const bare = await social.shareRubric({ text: '📊 Сколько платят в Бишкеке' });
  assert.equal(bare.instagram, null, 'без объявлений ролика нет');
  assert.equal(bare.threads.posted, true);
});

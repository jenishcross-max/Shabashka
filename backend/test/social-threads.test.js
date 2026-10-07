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
    publishReel: async () => 'reel',
    publishImage: async (url, caption) => {
      posted.push({ kind: 'ig-image', url, text: caption });
      return 'ig-image';
    },
    publishCarousel: async (urls, caption) => {
      posted.push({ kind: 'ig-carousel', urls, text: caption });
      return 'ig-carousel';
    },
    CAROUSEL_MAX: 10,
    publishingLimit: async () => ({ used: 0, total: 100 }),
    permalink: async () => '',
  },
  [at('social/card.js')]: {
    renderStill: async () => Buffer.from('jpeg'),
    stillName: () => 'card.jpg',
    collectionTitle: () => 'Вакансия дня',
    dayLabel: () => '25 сентября',
    COVER_AT: 3.6,
  },
  [at('social/video.js')]: {
    ...require('../src/social/video'),
    build: async () => ({ buffer: Buffer.from('mp4'), credit: null }),
  },
});

const social = requireSrc('social/index.js');

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
  assert.match(post.text, /шабашка\.com\/board#p9$/, 'ссылка на карточку сохранена целой');
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
  assert.match(posted.find((p) => p.kind === 'ig-image').text, /шабашка\.com\/orders\/3/);

  const onlyThreads = await social.raiseAd({ text: 'Текст', instagram: false });
  assert.equal(onlyThreads.instagram, null, 'в Instagram не поднимали');
  const bare = await social.raiseAd({ text: 'Текст', threads: false });
  assert.equal(bare.threads, null);
  assert.match(bare.instagram.reason, /нечего показать/);
});

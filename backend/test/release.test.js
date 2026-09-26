// Очередь роликов: пачка по три, выпуск по расписанию и срок жизни очереди
// (см. src/social/index.js).
//
// Почему это вообще проверяется тестом: у пачки есть цена — объявление ждёт
// компанию, — и именно из-за неё пачки однажды отключили совсем. Теперь их
// держит расписание, а не наполнение, и сломаться это может ровно двумя
// способами: неполная пачка не выедет никогда либо выедет чужая.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');

process.env.RENDER_EXTERNAL_URL = 'https://shabashka.test';
// Суточную норму здесь не проверяем — под неё есть quota.test.js. Поднимаем её,
// чтобы ролики этого файла не упёрлись в потолок и не ушли картинками.
process.env.INSTAGRAM_DAILY_LIMIT = '100';

// Между публикациями в Instagram полторы минуты — они держат часовой лимит
// Graph API (см. MIN_INTERVAL_MS в social/index.js). Ждать их по-настоящему
// тест не может, поэтому все долгие паузы в этом файле сжаты. Подменять надо
// до загрузки модуля: очередь берёт setTimeout в момент паузы, а сама пауза
// начинается сразу после первой же публикации.
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 1000 ? 5 : ms, ...rest);

const published = [];

const requireSrc = install({
  // Токены, слежка за рекламой и заявки ходят в базу — здесь они не нужны.
  [at('social/tokens.js')]: { get: () => 'токен', start: async () => {}, load: async () => {} },
  [at('social/adTracker.js')]: { start: () => {} },
  [at('social/leads.js')]: { start: () => {} },
  [at('social/instagram.js')]: {
    isConfigured: () => true,
    publishReel: async () => 'media-1',
    publishImage: async () => 'media-2',
    publishingLimit: async () => ({ used: 0, total: 100 }),
    permalink: async () => '',
  },
  [at('social/threads.js')]: {
    isConfigured: () => false,
    publishText: async () => 'th-1',
    publishingLimit: async () => ({ used: 0, total: 250 }),
    remove: async () => {},
  },
  [at('social/video.js')]: {
    build: async (items) => {
      published.push(items.map((i) => i.parsed.title));
      return { buffer: Buffer.from('mp4'), credit: null };
    },
    caption: () => 'подпись',
    threadsText: () => 'пост',
    fileName: () => 'reel.mp4',
    optional: (name, fallback) => fallback,
    COVER_MS: 3600,
  },
});

const social = requireSrc('social/index.js');

const listing = (title) => ({ title, description: title, city: 'Бишкек', phone: '+996700111222' });
const share = (title, listingType, priority = false) =>
  social.shareListing(listing(title), listingType, 'шабашка.com/x', { chatId: 1 }, { priority });

const byType = () => Object.fromEntries(social.queuedByType().map((q) => [q.listingType, q.count]));

// Из очереди пачку забирают сразу, а вот собирают ролик уже своим ходом: между
// публикациями стоит пауза, и заглушка сборки срабатывает позже. Поэтому
// «что уехало» спрашиваем не сразу, а дав очереди провернуться.
const settle = () => new Promise((r) => realSetTimeout(r, 60));
const lastReel = async () => {
  await settle();
  return published.at(-1);
};

test('объявление больше не уезжает в ту же секунду — оно встаёт в очередь', async () => {
  const result = await share('Заказ 1', 'order');
  assert.equal(result.queued, true);
  assert.equal(result.waiting, 1, 'в очереди своего типа оно первое');
  assert.deepEqual(byType(), { order: 1 });
});

test('выпуск берёт не больше пачки и только у одного типа', async () => {
  for (const n of [2, 3, 4]) await share(`Заказ ${n}`, 'order');
  await share('Вакансия 1', 'vacancy');
  assert.deepEqual(byType(), { order: 4, vacancy: 1 });

  const sent = social.release();
  assert.equal(sent, 3, 'в ролик едут три объявления, а не все четыре');
  assert.deepEqual(byType(), { order: 1, vacancy: 1 });
  assert.deepEqual(await lastReel(), ['Заказ 1', 'Заказ 2', 'Заказ 3'], 'в порядке поступления');
});

test('неполная пачка выезжает так же — иначе редкий тип не доедет никогда', async () => {
  // В очереди по одному заказу и одной вакансии. Заказ ждёт дольше — он и едет,
  // хотя до тройки ему далеко.
  assert.equal(social.release(), 1);
  assert.deepEqual(await lastReel(), ['Заказ 4']);
  assert.equal(social.release(), 1, 'следующим выпуском уезжает вакансия');
  assert.deepEqual(await lastReel(), ['Вакансия 1']);
  assert.equal(social.release(), 0, 'пустая очередь — выпускать нечего');
});

test('платная реклама не ждёт расписания и едет своим роликом, без попутчиков', async () => {
  // Расписание держит поток объявлений, а не то, за что заплатили: ждать до
  // двух с половиной часов реклама не должна. И ролик у неё свой —
  // рекламодатель платит за свой пост, а не за место в чужом выпуске.
  await share('Обычный заказ', 'order');
  const result = await share('Платная реклама', 'order', true);
  assert.equal(result.releaseInMin, 0, 'ждать нечего — так и сказано в ответе');
  assert.deepEqual(await lastReel(), ['Платная реклама']);
  assert.deepEqual(byType(), { order: 1 }, 'обычный заказ ждёт своего выпуска');
  assert.equal(social.release(), 1);
  assert.deepEqual(await lastReel(), ['Обычный заказ']);
});

test('объявление, прождавшее полдня, в ролик уже не попадает', async () => {
  await share('Вчерашний заказ', 'order');
  const realNow = Date.now;
  Date.now = () => realNow() + 7 * 60 * 60 * 1000;
  try {
    assert.equal(social.release(), 0, 'просроченное выбрасываем, а не выкладываем');
    assert.deepEqual(byType(), {}, 'и очередь за ним не растёт');
  } finally {
    Date.now = realNow;
  }
});

test('/now выпускает названный тип, не дожидаясь расписания', async () => {
  await share('Срочный заказ', 'order');
  await share('Срочная вакансия', 'vacancy');
  assert.equal(social.flushNow('vacancy'), 1, 'берём именно вакансию');
  assert.deepEqual(await lastReel(), ['Срочная вакансия']);
  assert.equal(social.flushNow('board'), 0, 'пустой тип — нечего выпускать');
});

// «🛍 Мои продукты» (см. src/telegram/products.js): свои товары админа —
// пригласительные, Scroll Book — с несколькими текстами и фото, в Threads и
// Instagram по кнопке и по расписанию.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at, chat, wait, productStoreStub } = require('./helpers/stub');

const tg = chat();
const views = [];
tg.api.editMessageText = async (chatId, messageId, text) => {
  views.push(String(text));
};
const store = productStoreStub();

const shared = [];
const asked = [];
let shareResult = () => ({
  threads: { posted: true, id: 't1' },
  instagram: { posted: true, id: 'i1' },
});
const social = {
  shareProduct: async (job) => {
    shared.push(job);
    return shareResult(job);
  },
  threadsQueued: (opts) => {
    asked.push(opts);
    return 0;
  },
  THREADS_INTERVAL_MIN: 10,
  threadsPermalink: async (id) => `https://threads.net/p/${id}`,
  instagramPermalink: async (id) => `https://instagram.com/p/${id}`,
  threadsInsights: async () => ({ views: 1234 }),
};

const requireSrc = install({
  [at('telegram/api.js')]: tg.api,
  [at('telegram/productStore.js')]: store,
  [at('social/index.js')]: social,
  // Скачанные из Telegram «файлы» в тесте — не картинки: подготовку фото
  // проверяем отдельно, на настоящих.
  [at('social/photos.js')]: {
    prepare: async (buffers) => ({
      threads: buffers.map((b) => Buffer.from(`t:${b}`)),
      instagram: buffers.map((b) => Buffer.from(`i:${b}`)),
    }),
  },
});

const products = requireSrc('telegram/products.js');

const CHAT = 42;
let msgSeq = 0;
const message = (fields) => ({ message_id: (msgSeq += 1), chat: { id: CHAT }, from: { id: 1 }, ...fields });
const say = (text) => products.onMessage(message({ text }), { isMenuKey: (t) => t === '📣 Реклама' });
const sendPhoto = (fileId, caption) =>
  products.onMessage(message({ photo: [{ file_id: `${fileId}-small` }, { file_id: fileId }], caption }));
const sendVideo = (fields, caption) => products.onMessage(message({ ...fields, caption }));
const press = (data) =>
  products.onCallback(
    { id: 'q', from: { id: 1 }, data, message: { chat: { id: CHAT }, message_id: 7 } },
    data.split(':').slice(1),
    {
      show: async (chatId, view) => {
        views.push(view.text);
        lastView = view;
      },
    }
  );
let lastView = null;
const buttons = () => lastView.extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);

test('новый продукт: название, тексты и фото альбомом, потом расписание', async () => {
  await press('pr:new');
  assert.ok(tg.has(/Как его назвать/));

  assert.equal(await say('Пригласительные'), true);
  assert.equal(store.rows.size, 1);
  assert.ok(tg.has(/Присылайте тексты, фото и видео для «Пригласительные»/));

  tg.clear();
  await say('Свадебные пригласительные на заказ, от 50 сом за штуку. WhatsApp 0700 123 456');
  await say(`${'очень длинный текст '.repeat(30)}`);
  assert.ok(tg.has(/Threads принимает не больше 500/), 'длинный текст отклонён сразу');
  // Альбом: три фото подряд, подпись — у первого.
  await sendPhoto('ph1', 'Пригласительные на юбилей и той');
  await sendPhoto('ph2');
  await sendPhoto('ph3');
  assert.equal(tg.count(/Сохранил/), 0, 'на каждое фото альбома не отвечаем');
  await wait(1700);
  assert.equal(tg.count(/Сохранил/), 1, 'один ответ на всю пачку');
  assert.ok(tg.has(/Сохранил 2 текста и 3 фото/), tg.dump());

  const [product] = await store.list();
  assert.deepEqual(product.texts.length, 2);
  assert.deepEqual(
    product.photos.map((p) => p.file_id),
    ['ph1', 'ph2', 'ph3'],
    'берём самый крупный размер фото'
  );

  await press(`pr:done:${product.id}`);
  assert.match(lastView.text, /Как часто выкладывать/, 'у нового продукта после «Готово» — расписание');
  await press(`pr:every:${product.id}:3`);
  assert.equal((await store.get(product.id)).every_days, 3);
  assert.match(lastView.text, /раз в 3 дня/);
  assert.ok(buttons().includes(`pr:pub:${product.id}`));

  // Ввод закончен — следующее сообщение снова объявление для разбора.
  assert.equal(await say('Требуется повар в кафе, 0700111222'), false);
});

test('команда и кнопка меню прерывают ввод, а не становятся текстом продукта', async () => {
  const product = await store.create('Scroll Book');
  await press(`pr:add:${product.id}`);
  assert.equal(await say('/stats'), false, '/stats уходит боту');
  assert.equal(await say('Ещё текст'), false, 'ввод прерван');

  await press(`pr:add:${product.id}`);
  assert.equal(await say('📣 Реклама'), false);
  assert.deepEqual((await store.get(product.id)).texts, []);
});

test('каждый выход — следующий текст и карусель со следующего фото', async () => {
  const product = await store.create('Scroll Book');
  await store.addText(product.id, 'Текст один');
  await store.addText(product.id, 'Текст два');
  for (const id of ['a', 'b', 'c']) await store.addPhoto(product.id, { file_id: id, kind: 'photo' });
  tg.api.downloadFile = async (fileId) => Buffer.from(fileId);

  const reports = [];
  const report = async (view) => {
    reports.push(view.text);
  };

  shared.length = 0;
  await products.publish(product.id, report);
  await products.publish(product.id, report);
  await products.publish(product.id, report);

  assert.deepEqual(
    shared.map((s) => s.text),
    ['Текст один', 'Текст два', 'Текст один']
  );
  assert.deepEqual(
    shared.map((s) => s.threadsImages.map(String).join('')),
    ['t:at:bt:c', 't:bt:ct:a', 't:ct:at:b'],
    'первым каждый раз идёт следующее фото'
  );
  assert.equal(shared[0].instagramImages.length, 3);
  assert.deepEqual(asked.at(-1), { priority: true }, 'в отчёте — сколько впереди срочных, а не вся очередь');
  assert.match(reports.at(-1), /Threads: <a href="https:\/\/threads\.net\/p\/t1">вышел/);
  assert.equal((await store.get(product.id)).turn, 3);
  assert.equal(store.log.filter((p) => p.productId === product.id).length, 6, 'по записи на площадку');

  // Карточка показывает выходы и просмотры Threads.
  await press(`pr:open:${product.id}`);
  assert.match(lastView.text, /1\s234 просмотра/);
  assert.match(lastView.text, /Следующим пойдёт текст №2/);
});

test('не вышло нигде — текст не потрачен, есть «Ещё раз»', async () => {
  const product = await store.create('Пригласительные на юбилей');
  await store.addText(product.id, 'Первый');
  await store.addText(product.id, 'Второй');
  shareResult = () => ({
    threads: { posted: false, reason: 'токен Threads протух' },
    instagram: { posted: false, reason: 'без фото Instagram пост не принимает' },
  });
  const reports = [];
  await products.publish(product.id, async (view) => {
    reports.push(view);
  });
  shareResult = () => ({ threads: { posted: true, id: 't2' }, instagram: { posted: false, reason: 'нет фото' } });

  const last = reports.at(-1);
  assert.match(last.text, /токен Threads протух/);
  assert.match(last.text, /в следующий раз пойдёт он же/);
  assert.ok(last.extra.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === `pr:pub:${product.id}`));
  assert.equal((await store.get(product.id)).turn, 0);
});

test('без текстов публиковать нечего; второй выход, пока идёт первый, не начинается', async () => {
  const empty = await store.create('Пустой');
  const reports = [];
  const report = async (view) => {
    reports.push(view.text);
  };
  await products.publish(empty.id, report);
  assert.match(reports.at(-1), /нет ни одного текста/);

  const product = await store.create('Двойной');
  await store.addText(product.id, 'Текст');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const before = shared.length;
  const original = social.shareProduct;
  social.shareProduct = async (job) => {
    shared.push(job);
    await gate;
    return { threads: { posted: true, id: 't3' }, instagram: { posted: false, reason: 'нет фото' } };
  };
  const first = products.publish(product.id, report);
  await wait(10);
  await products.publish(product.id, report);
  assert.match(reports.at(-1), /уже выходит/);
  release();
  await first;
  social.shareProduct = original;
  assert.equal(shared.length - before, 1);
});

test('расписание: только днём по Бишкеку и только тот, чей срок подошёл', async () => {
  for (const id of [...store.rows.keys()]) store.rows.delete(id);
  const product = await store.create('По расписанию');
  await store.addText(product.id, 'Текст');
  await store.setEvery(product.id, 2);

  const reports = [];
  const report = async (view) => {
    reports.push(view.text);
  };
  shared.length = 0;
  // 03:00 по Бишкеку (UTC+6) — ночью не выходим.
  await products.tick(report, Date.parse('2026-10-08T21:00:00Z'));
  assert.equal(shared.length, 0);
  // 14:00 по Бишкеку.
  await products.tick(report, Date.parse('2026-10-08T08:00:00Z'));
  assert.equal(shared.length, 1);
  // Только что вышел — до срока через два дня больше не выходит.
  await products.tick(report, Date.parse('2026-10-08T08:10:00Z'));
  assert.equal(shared.length, 1);

  await press(`pr:pause:${product.id}`);
  assert.equal((await store.get(product.id)).paused, true);
  store.rows.get(product.id).posted_at = '2026-10-01T00:00:00Z';
  await products.tick(report, Date.parse('2026-10-08T08:20:00Z'));
  assert.equal(shared.length, 1, 'на паузе сам не выходит');
});

test('тексты и фото убираются по номеру, продукт удаляется с вопросом', async () => {
  const product = await store.create('Удаляемый');
  await store.addText(product.id, 'Раз');
  await store.addText(product.id, 'Два');
  await store.addPhoto(product.id, { file_id: 'x', kind: 'photo' });

  await press(`pr:txt:${product.id}`);
  assert.ok(buttons().includes(`pr:delt:${product.id}:1`));
  await press(`pr:delt:${product.id}:0`);
  assert.deepEqual((await store.get(product.id)).texts, ['Два']);

  await press(`pr:delp:${product.id}:0`);
  assert.deepEqual((await store.get(product.id)).photos, []);

  await press(`pr:del:${product.id}`);
  assert.match(lastView.text, /Удалить «Удаляемый»/);
  assert.ok(await store.get(product.id), 'до подтверждения не удаляем');
  await press(`pr:delok:${product.id}`);
  assert.equal(await store.get(product.id), null);
  assert.match(lastView.text, /Мои продукты/);
});

// Видео: промо-ролик продукта — Reels в Instagram и роликом в Threads.
test('видео: принимается файлом и роликом, тяжёлое и слишком длинное — с объяснением', async () => {
  const product = await store.create('Шабашка');
  await press(`pr:add:${product.id}`);
  assert.ok(tg.has(/видео/i), 'в подсказке сказано, что видео можно');

  tg.clear();
  await sendVideo({ video: { file_id: 'v1', file_size: 3_000_000, duration: 24 } }, 'Биржа на шабашка.com');
  await sendVideo({ document: { file_id: 'v2', mime_type: 'video/mp4', file_size: 2_500_000 } });
  await wait(1700);
  assert.ok(tg.has(/Сохранил 1 текст и 2 видео/), tg.dump());
  assert.deepEqual(
    (await store.get(product.id)).videos.map((v) => [v.file_id, v.kind]),
    [
      ['v1', 'video'],
      ['v2', 'document'],
    ]
  );

  tg.clear();
  await sendVideo({ video: { file_id: 'big', file_size: 25 * 1024 * 1024, duration: 30 } });
  assert.ok(tg.has(/тяжелее 20 МБ/), tg.dump());
  await sendVideo({ video: { file_id: 'long', file_size: 1_000_000, duration: 400 } });
  assert.ok(tg.has(/5 минут/), tg.dump());
  await sendVideo({ video: { file_id: 'short', file_size: 100_000, duration: 2 } });
  assert.ok(tg.has(/3 секунд/), tg.dump());
  assert.equal((await store.get(product.id)).videos.length, 2, 'неподходящие не сохранены');
  await press(`pr:done:${product.id}`);
});

test('видео и фото чередуются: каждый ролик — своим выходом, фото — каруселью', async () => {
  const product = await store.create('С видео');
  await store.addText(product.id, 'Текст');
  for (const id of ['a', 'b']) await store.addPhoto(product.id, { file_id: id, kind: 'photo' });
  for (const id of ['v1', 'v2']) await store.addVideo(product.id, { file_id: id, kind: 'video' });
  tg.api.downloadFile = async (fileId) => Buffer.from(fileId);

  const reports = [];
  const report = async (view) => {
    reports.push(view.text);
  };
  shared.length = 0;
  for (let i = 0; i < 4; i += 1) await products.publish(product.id, report);

  assert.deepEqual(
    shared.map((s) => (s.video ? `video:${s.video}` : `photos:${s.threadsImages.length}`)),
    ['video:v1', 'video:v2', 'photos:2', 'video:v1']
  );
  assert.equal(shared[0].threadsImages.length, 0, 'с видео фото не готовим');
  assert.ok(reports.some((r) => /видео №1 из 2/.test(r)), reports.join('\n'));

  await press(`pr:open:${product.id}`);
  assert.match(lastView.text, /2 фото, 2 видео/);
  assert.match(lastView.text, /Следующим пойдёт видео №2/);
  assert.ok(buttons().includes(`pr:vid:${product.id}`));

  await press(`pr:vid:${product.id}`);
  assert.ok(buttons().includes(`pr:delv:${product.id}:1`));
  await press(`pr:delv:${product.id}:0`);
  assert.deepEqual((await store.get(product.id)).videos.map((v) => v.file_id), ['v2']);
});

test('видео не скачалось из Telegram — выход идёт с фото, а в отчёте сказано почему', async () => {
  const product = await store.create('Сломанное видео');
  await store.addText(product.id, 'Текст');
  await store.addPhoto(product.id, { file_id: 'p', kind: 'photo' });
  await store.addVideo(product.id, { file_id: 'gone', kind: 'video' });
  tg.api.downloadFile = async (fileId) => {
    if (fileId === 'gone') throw new Error('file is too big');
    return Buffer.from(fileId);
  };
  const reports = [];
  shared.length = 0;
  await products.publish(product.id, async (view) => {
    reports.push(view.text);
  });
  assert.equal(shared[0].video, undefined);
  assert.equal(shared[0].threadsImages.length, 1);
  assert.match(reports.at(-1), /видео не скачалось/);
});

test('сводка: что из продуктов вышло сегодня, куда и сколько набрало, а что не вышло — почему', async () => {
  store.rows.clear();
  store.log.length = 0;
  const book = await store.create('Scroll Book');
  await store.addText(book.id, 'Нужны тестировщики на Android');
  await store.addPhoto(book.id, { file_id: 'cover', kind: 'photo' });
  await store.setEvery(book.id, 1);
  const invites = await store.create('Пригласительные');
  await store.addText(invites.id, 'Свадебные пригласительные');
  await store.setEvery(invites.id, 1);
  await store.setPaused(invites.id, true);
  const cards = await store.create('Визитки');
  await store.addText(cards.id, 'Визитки за день');

  const saved = shareResult;
  shareResult = () => ({
    threads: { posted: true, id: 't-summary' },
    instagram: { posted: false, reason: 'норма площадки выбрана' },
  });
  try {
    await products.publish(book.id, async () => {});
  } finally {
    shareResult = saved;
  }

  const lines = await products.summaryLines();
  assert.equal(lines[0], '🛍 Мои продукты');
  const text = lines.join('\n');
  assert.match(text, /Scroll Book — Threads \d\d:\d\d 👁 1\s234 · Instagram \d\d:\d\d ⚠️ норма площадки выбрана/);
  assert.match(text, /Пригласительные — сегодня не выходил: на паузе/);
  assert.match(text, /Визитки — сегодня не выходил: расписания нет, только по кнопке/);

  store.rows.clear();
  assert.deepEqual(await products.summaryLines(), [], 'продуктов нет — блока нет');
});

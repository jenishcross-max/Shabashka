const tg = require('./api');
const { num, plural, viewsWord, clamp, whenText } = require('./format');
const { keyboard, rowsOf, BACK: MENU } = require('./menu');

// Экраны раздела «🛍 Мои продукты» (см. products.js). Как и menu.js — только
// тексты и кнопки из готовых данных, без базы и без Telegram.

const DAY_MS = 24 * 60 * 60 * 1000;
// Длиннее Threads пост не принимает, а текст у продукта один на обе площадки.
const TEXT_MAX = 500;
// Расписание: посты выходят только днём — ночной пост никто не увидит, а лента
// к утру его уже унесёт.
const DAY_FROM = 10;
const DAY_TO = 21;
const EVERY = [1, 2, 3, 7];

const cb = (...parts) => ['pr', ...parts].join(':');
const LIST = { text: '⬅️ Продукты', callback_data: 'm:products' };
const toCard = (product) => ({ text: '⬅️ К продукту', callback_data: cb('open', product.id) });
const CANCEL = { text: '✖️ Отмена', callback_data: cb('cancel') };

const textsWord = (n) => plural(n, ['текст', 'текста', 'текстов']);
const name = (product) => tg.esc(clamp(product.name, 60));
const counts = (product) => `${product.texts.length} ${textsWord(product.texts.length)}, ${product.photos.length} фото`;

function everyText(days) {
  if (!days) return 'только по кнопке';
  if (days === 1) return 'каждый день';
  if (days === 7) return 'раз в неделю';
  return `раз в ${days} ${plural(days, ['день', 'дня', 'дней'])}`;
}

// Когда продукт выйдет сам. Окно 10:00–21:00 отдельно не считаем: «≈ 12
// октября, 23:40» с пометкой про окно понятнее, чем пересчитанное утро.
function nextText(product, now) {
  if (!product.every_days) return '';
  if (product.paused) return 'на паузе';
  if (!product.texts.length) return 'ждёт хотя бы одного текста';
  const at = product.posted_at ? new Date(product.posted_at).getTime() + product.every_days * DAY_MS : now;
  return at <= now ? 'при ближайшей проверке' : `≈ ${whenText(at)}`;
}

function listView(products) {
  const text = [
    '🛍 <b>Мои продукты</b>',
    products.length
      ? 'Выходят в Threads и Instagram по кнопке и по расписанию — каждый раз со следующим текстом из списка.'
      : 'Пока пусто. Добавьте первый: название, несколько вариантов текста и фото — дальше бот выкладывает его сам.',
  ].join('\n');
  const rows = products.map((p) => [
    {
      text: `${p.paused ? '⏸' : p.every_days ? '🔁' : '🛍'} ${clamp(p.name, 28)} · ${counts(p)}`,
      callback_data: cb('open', p.id),
    },
  ]);
  return { text, extra: keyboard([...rows, [{ text: '➕ Добавить продукт', callback_data: cb('new') }], [MENU]]) };
}

const PLATFORM = { threads: 'Threads', instagram: 'Instagram' };

// views — просмотры постов Threads по их id, если Threads их отдал.
function postLine(post, views) {
  const where = PLATFORM[post.platform] || post.platform;
  if (!post.post_id) return `• ${whenText(post.created_at)} · ${where} — не вышло: ${tg.esc(clamp(post.note || '', 80))}`;
  const link = post.link ? `<a href="${tg.esc(post.link)}">пост</a>` : 'пост';
  const seen = views[post.post_id];
  return `• ${whenText(post.created_at)} · ${where} — ${link}${Number.isFinite(seen) ? `, ${num(seen)} ${viewsWord(seen)}` : ''}`;
}

function cardView({ product, posts = [], views = {}, now = Date.now() }) {
  const lines = [`🛍 <b>${name(product)}</b>`, `📝 ${counts(product)}`];
  lines.push(`🗓 Расписание: ${everyText(product.every_days)}${product.every_days ? ` · следующий выход: ${nextText(product, now)}` : ''}`);
  if (product.turn) {
    lines.push(
      `📤 Выходил ${num(product.turn)} ${plural(product.turn, ['раз', 'раза', 'раз'])}${
        product.posted_at ? `, последний — ${whenText(product.posted_at)}` : ''
      }`
    );
  }

  lines.push('');
  if (product.texts.length) {
    const next = product.turn % product.texts.length;
    lines.push(`Следующим пойдёт текст №${next + 1}: «${tg.esc(clamp(product.texts[next], 120))}»`);
  } else {
    lines.push('⚠️ Ни одного текста — публиковать нечего.');
  }
  if (!product.photos.length) lines.push('ℹ️ Без фото Instagram пост не примет — выйдет только в Threads.');

  if (posts.length) lines.push('', '<b>Последние выходы</b>', ...posts.map((p) => postLine(p, views)));

  const schedule = [{ text: '🗓 Расписание', callback_data: cb('sch', product.id) }];
  if (product.every_days) {
    schedule.push({
      text: product.paused ? '▶️ Снять с паузы' : '⏸ Пауза',
      callback_data: cb('pause', product.id),
    });
  }
  return {
    text: lines.join('\n'),
    extra: keyboard([
      [{ text: '🚀 Опубликовать сейчас', callback_data: cb('pub', product.id) }],
      [
        { text: `📝 Тексты (${product.texts.length})`, callback_data: cb('txt', product.id) },
        { text: `🖼 Фото (${product.photos.length})`, callback_data: cb('pho', product.id) },
      ],
      [{ text: '➕ Добавить тексты или фото', callback_data: cb('add', product.id) }],
      schedule,
      [{ text: '🗑 Удалить', callback_data: cb('del', product.id) }, LIST],
    ]),
  };
}

function textsView(product) {
  const lines = [`📝 <b>Тексты «${name(product)}»</b>`, 'Бот берёт их по очереди — каждый выход со следующим.', ''];
  if (!product.texts.length) lines.push('Пока ни одного.');
  product.texts.forEach((t, i) => lines.push(`<b>№${i + 1}.</b> ${tg.esc(clamp(t, 150))}`));
  const remove = product.texts.map((_, i) => ({ text: `🗑 №${i + 1}`, callback_data: cb('delt', product.id, i) }));
  return {
    text: lines.join('\n'),
    extra: keyboard([
      ...rowsOf(remove, 5),
      [{ text: '➕ Добавить', callback_data: cb('add', product.id) }, toCard(product)],
    ]),
  };
}

function photosView(product, max) {
  const lines = [
    `🖼 <b>Фото «${name(product)}»</b>: ${product.photos.length} из ${max}`,
    'Одно фото — пост картинкой, несколько — каруселью. Первым каждый раз идёт следующее фото, чтобы посты не начинались одинаково.',
  ];
  const remove = product.photos.map((_, i) => ({ text: `🗑 №${i + 1}`, callback_data: cb('delp', product.id, i) }));
  return {
    text: lines.join('\n'),
    extra: keyboard([
      ...(product.photos.length ? [[{ text: '👀 Показать все', callback_data: cb('show', product.id) }]] : []),
      ...rowsOf(remove, 5),
      [{ text: '➕ Добавить', callback_data: cb('add', product.id) }, toCard(product)],
    ]),
  };
}

function scheduleView(product) {
  const mark = (days) => ((product.every_days || 0) === days ? '✅ ' : '');
  return {
    text: [
      `🗓 <b>Как часто выкладывать «${name(product)}»?</b>`,
      `Посты по расписанию выходят днём, с ${DAY_FROM}:00 до ${DAY_TO}:00 по Бишкеку.`,
      'Кнопка «Опубликовать сейчас» работает всегда.',
    ].join('\n'),
    extra: keyboard([
      ...rowsOf(
        EVERY.map((days) => ({ text: `${mark(days)}${everyText(days)}`, callback_data: cb('every', product.id, days) })),
        2
      ),
      [{ text: `${mark(0)}Только по кнопке`, callback_data: cb('every', product.id, 0) }],
      [toCard(product)],
    ]),
  };
}

function confirmDeleteView(product) {
  return {
    text: [
      `🗑 Удалить «${name(product)}»?`,
      'Тексты, фото и расписание удалятся из бота. Посты, которые уже вышли в Threads и Instagram, останутся.',
    ].join('\n'),
    extra: keyboard([[{ text: '🗑 Да, удалить', callback_data: cb('delok', product.id) }, toCard(product)]]),
  };
}

function namePrompt() {
  return {
    text: [
      '🛍 <b>Новый продукт</b>',
      'Как его назвать? Название — только для меню, в посты оно не идёт.',
      'Например: «Пригласительные» или «Scroll Book».',
    ].join('\n'),
    extra: keyboard([[CANCEL]]),
  };
}

// fresh — продукт только что заведён: после «Готово» у него дальше расписание.
function contentPrompt(product, { fresh = false } = {}) {
  return {
    text: [
      `✍️ Присылайте тексты и фото для «${name(product)}» — в любом порядке, фото можно альбомом.`,
      '',
      '• Каждый текст — отдельным сообщением. Это варианты одного поста: бот берёт их по очереди, чтобы посты не повторялись слово в слово.',
      `• Текст — до ${TEXT_MAX} знаков: длиннее Threads не принимает. Ссылку (на Google Play, на WhatsApp) пишите прямо в тексте.`,
      '• Фото с подписью — это и фото, и текст.',
      '',
      fresh ? 'Когда всё пришлёте — «✅ Готово», дальше выберем расписание.' : 'Когда закончите — «✅ Готово».',
    ].join('\n'),
    extra: keyboard([[{ text: '✅ Готово', callback_data: cb('done', product.id) }, CANCEL]]),
  };
}

// Ответ на присланное. Альбом — это пачка сообщений, и на каждое фото по
// ответу было бы шумом: products.js собирает их и отвечает одним.
function savedView({ product, texts, photos, full = [] }) {
  const got = [texts && `${texts} ${textsWord(texts)}`, photos && `${photos} фото`].filter(Boolean).join(' и ');
  const lines = [];
  if (got) lines.push(`✅ Сохранил ${got}. У «${name(product)}» теперь ${counts(product)}.`);
  if (full.includes('texts')) lines.push('⚠️ Текстов уже максимум — лишние не сохранил. Уберите ненужные в «📝 Тексты».');
  if (full.includes('photos')) lines.push('⚠️ Фото уже максимум — лишние не сохранил: больше Instagram в карусель не берёт.');
  lines.push('Ещё — присылайте, или «✅ Готово».');
  return {
    text: lines.join('\n'),
    extra: keyboard([[{ text: '✅ Готово', callback_data: cb('done', product.id) }]]),
  };
}

function tooLongText(length) {
  return `✂️ В тексте ${num(length)} знаков, а Threads принимает не больше ${TEXT_MAX}. Сократите и пришлите ещё раз — этот не сохранил.`;
}

function result({ result: r, link }) {
  if (r.posted) return link ? `<a href="${tg.esc(link)}">вышел</a>` : 'вышел';
  return `не вышел: ${tg.esc(clamp(r.reason || 'причина неизвестна', 150))}`;
}

// Итог выхода продукта: что ушло и куда.
function publishedView({ product, textNo, threads, instagram, notes = [] }) {
  const posted = threads.result.posted || instagram.result.posted;
  return {
    text: [
      `${posted ? '🛍' : '⚠️'} <b>${name(product)}</b> — текст №${textNo + 1}`,
      `🧵 Threads: ${result(threads)}`,
      `📸 Instagram: ${result(instagram)}`,
      ...notes.map((n) => `ℹ️ ${tg.esc(n)}`),
      ...(posted ? [] : ['Текст не потрачен: в следующий раз пойдёт он же.']),
    ].join('\n'),
    extra: keyboard([
      [
        ...(posted ? [] : [{ text: '🔁 Ещё раз', callback_data: cb('pub', product.id) }]),
        { text: '🛍 Открыть продукт', callback_data: cb('open', product.id) },
      ],
    ]),
  };
}

module.exports = {
  listView,
  cardView,
  textsView,
  photosView,
  scheduleView,
  confirmDeleteView,
  namePrompt,
  contentPrompt,
  savedView,
  tooLongText,
  publishedView,
  everyText,
  TEXT_MAX,
  DAY_FROM,
  DAY_TO,
};

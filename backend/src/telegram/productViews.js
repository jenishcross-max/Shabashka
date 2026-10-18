const tg = require('./api');
const { num, plural, viewsWord, clamp, clock, whenText } = require('./format');
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
// Окно в минутах: «N раз в день» делят его поровну (см. due в productStore.js).
const WINDOW_MIN = (DAY_TO - DAY_FROM) * 60;
const HOUR_MS = 60 * 60 * 1000;
const BISHKEK_MS = 6 * HOUR_MS;
const EVERY = [1, 2, 3, 7];
const PER_DAY = [2, 3, 4];

const cb = (...parts) => ['pr', ...parts].join(':');
const LIST = { text: '⬅️ Продукты', callback_data: 'm:products' };
const toCard = (product) => ({ text: '⬅️ К продукту', callback_data: cb('open', product.id) });
const CANCEL = { text: '✖️ Отмена', callback_data: cb('cancel') };

const textsWord = (n) => plural(n, ['текст', 'текста', 'текстов']);
const name = (product) => tg.esc(clamp(product.name, 60));
const videosOf = (product) => product.videos || [];
const counts = (product) => {
  const videos = videosOf(product).length;
  const base = `${product.texts.length} ${textsWord(product.texts.length)}, ${product.photos.length} фото`;
  return videos ? `${base}, ${videos} видео` : base;
};

// Что покажет выход номер turn. Каждое видео — свой выход, все фото вместе —
// ещё один: с двумя роликами и фото посты идут «видео, видео, фото» по кругу.
// Без видео — всегда фото (или текст), как было до роликов.
// { kind: 'video', index, total } | { kind: 'photos' }
function mediaOf(product, turn) {
  const videos = videosOf(product).length;
  if (!videos) return { kind: 'photos' };
  const slot = turn % (videos + (product.photos.length ? 1 : 0));
  return slot < videos ? { kind: 'video', index: slot, total: videos } : { kind: 'photos' };
}

// perDay — сколько раз в день (только при days = 1).
function everyText(days, perDay) {
  if (!days) return 'только по кнопке';
  if (days === 1 && perDay > 1) return `${perDay} ${plural(perDay, ['раз', 'раза', 'раз'])} в день`;
  if (days === 1) return 'каждый день';
  if (days === 7) return 'раз в неделю';
  return `раз в ${days} ${plural(days, ['день', 'дня', 'дней'])}`;
}

function gapMs(product) {
  return product.per_day > 1 ? Math.floor(WINDOW_MIN / product.per_day) * 60 * 1000 : product.every_days * DAY_MS;
}

// Срок, который выпал на ночь, — это ближайшие 10:00: ночью бот не публикует.
// Без этого у «3 раза в день» последний выход дня обещал бы следующий на 21:10.
function intoWindow(at) {
  const local = new Date(at + BISHKEK_MS);
  const hour = local.getUTCHours();
  if (hour >= DAY_FROM && hour < DAY_TO) return at;
  const morning = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), DAY_FROM) - BISHKEK_MS;
  return hour < DAY_FROM ? morning : morning + DAY_MS;
}

// Когда продукт выйдет сам.
function nextText(product, now) {
  if (!product.every_days) return '';
  if (product.paused) return 'на паузе';
  if (!product.texts.length) return 'ждёт хотя бы одного текста';
  const at = product.posted_at ? intoWindow(new Date(product.posted_at).getTime() + gapMs(product)) : now;
  return at <= now ? 'при ближайшей проверке' : `≈ ${whenText(at)}`;
}

function listView(products) {
  const text = [
    '🛍 <b>Мои продукты</b>',
    products.length
      ? 'Выходят в Threads и Instagram по кнопке и по расписанию — каждый раз со следующим текстом из списка.'
      : 'Пока пусто. Добавьте первый: название, несколько вариантов текста, фото или видео — дальше бот выкладывает его сам.',
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

// Строка продукта в сводке (см. summaryLines в products.js). Вышел — куда, во
// сколько и сколько набрал в Threads (у Instagram просмотров не спрашиваем:
// ✅ — вышел); не вышел на площадку — её причина. Сегодня не выходил вовсе —
// почему: пауза, нет текстов, нет расписания или срок ещё не подошёл.
// Несколько выходов за день — одна часть на площадку: время каждого и
// просмотры в сумме, а не восемь частей через точку.
function summaryLine(product, posts, seen, now) {
  if (!posts.length) {
    const next = nextText(product, now);
    let why = next;
    if (!product.every_days) why = 'расписания нет, только по кнопке';
    else if (next.startsWith('≈')) why = `следующий выход ${next}`;
    else if (next === 'при ближайшей проверке') why = `срок подошёл — выйдет днём, с ${DAY_FROM}:00 до ${DAY_TO}:00`;
    return `• ${name(product)} — сегодня не выходил: ${why}`;
  }
  const times = (list) => list.map((p) => clock(p.created_at)).join(', ');
  const parts = [];
  for (const platform of new Set(posts.map((p) => p.platform))) {
    const where = PLATFORM[platform] || platform;
    const mine = posts.filter((p) => p.platform === platform);
    const ok = mine.filter((p) => p.post_id);
    const failed = mine.filter((p) => !p.post_id);
    if (ok.length) {
      const known = ok.filter((p) => Number.isFinite(seen[p.post_id]));
      const total = known.reduce((sum, p) => sum + seen[p.post_id], 0);
      parts.push(`${where} ${times(ok)} ${known.length ? `👁 ${num(total)}` : '✅'}`);
    }
    if (failed.length) {
      const last = failed[failed.length - 1];
      parts.push(`${where} ${times(failed)} ⚠️ ${tg.esc(clamp(last.note || 'не вышло', 80))}`);
    }
  }
  return `• ${name(product)} — ${parts.join(' · ')}`;
}

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
  lines.push(
    `🗓 Расписание: ${everyText(product.every_days, product.per_day)}${
      product.every_days ? ` · следующий выход: ${nextText(product, now)}` : ''
    }`
  );
  if (product.turn) {
    lines.push(
      `📤 Выходил ${num(product.turn)} ${plural(product.turn, ['раз', 'раза', 'раз'])}${
        product.posted_at ? `, последний — ${whenText(product.posted_at)}` : ''
      }`
    );
  }

  lines.push('');
  const media = mediaOf(product, product.turn);
  if (media.kind === 'video') {
    lines.push(`🎬 Следующим пойдёт видео №${media.index + 1} из ${media.total} — Reels в Instagram.`);
  }
  if (product.texts.length) {
    const next = product.turn % product.texts.length;
    lines.push(`Следующим пойдёт текст №${next + 1}: «${tg.esc(clamp(product.texts[next], 120))}»`);
  } else {
    lines.push('⚠️ Ни одного текста — публиковать нечего.');
  }
  if (!product.photos.length && !videosOf(product).length) {
    lines.push('ℹ️ Без фото и видео Instagram пост не примет — выйдет только в Threads.');
  }
  // Один и тот же пост чаще раза в два дня лента показывает хуже, а
  // подписчики начинают пролистывать.
  const enough = 2 * (product.per_day || 1);
  if (product.per_day > 1 && product.texts.length < enough) {
    lines.push(
      `ℹ️ На ${everyText(1, product.per_day)} лучше хотя бы ${enough} ${textsWord(enough)}, а сейчас ${product.texts.length}: иначе один и тот же пост выходит чуть ли не каждый день, и лента показывает его хуже.`
    );
  }

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
        { text: `🎬 Видео (${videosOf(product).length})`, callback_data: cb('vid', product.id) },
      ],
      [{ text: '➕ Добавить тексты, фото или видео', callback_data: cb('add', product.id) }],
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

function videosView(product, max) {
  const videos = videosOf(product);
  const lines = [
    `🎬 <b>Видео «${name(product)}»</b>: ${videos.length} из ${max}`,
    'Каждое видео выходит отдельным постом: Reels в Instagram и роликом в Threads. Видео и фото чередуются — сначала ролики по очереди, потом пост с фото.',
  ];
  const remove = videos.map((_, i) => ({ text: `🗑 №${i + 1}`, callback_data: cb('delv', product.id, i) }));
  return {
    text: lines.join('\n'),
    extra: keyboard([
      ...(videos.length ? [[{ text: '👀 Показать все', callback_data: cb('showv', product.id) }]] : []),
      ...rowsOf(remove, 5),
      [{ text: '➕ Добавить', callback_data: cb('add', product.id) }, toCard(product)],
    ]),
  };
}

function scheduleView(product) {
  const perDay = product.per_day > 1 ? product.per_day : 0;
  const mark = (days) => (!perDay && (product.every_days || 0) === days ? '✅ ' : '');
  const markTimes = (n) => (perDay === n ? '✅ ' : '');
  return {
    text: [
      `🗓 <b>Как часто выкладывать «${name(product)}»?</b>`,
      `Посты по расписанию выходят днём, с ${DAY_FROM}:00 до ${DAY_TO}:00 по Бишкеку.`,
      'Несколько раз в день — через равные промежутки с утра: 3 раза — около 10:00, 13:40 и 17:20. Чем чаще выход, тем больше нужно вариантов текста.',
      'Кнопка «Опубликовать сейчас» работает всегда.',
    ].join('\n'),
    // От частого к редкому, по два в ряд: три в ряд на телефоне обрезаются.
    extra: keyboard([
      ...rowsOf(
        [
          ...[...PER_DAY].reverse().map((n) => ({
            text: `${markTimes(n)}${everyText(1, n)}`,
            callback_data: cb('times', product.id, n),
          })),
          ...EVERY.map((days) => ({ text: `${mark(days)}${everyText(days)}`, callback_data: cb('every', product.id, days) })),
        ],
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
      'Тексты, фото, видео и расписание удалятся из бота. Посты, которые уже вышли в Threads и Instagram, останутся.',
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
      `✍️ Присылайте тексты, фото и видео для «${name(product)}» — в любом порядке, фото можно альбомом.`,
      '',
      '• Каждый текст — отдельным сообщением. Это варианты одного поста: бот берёт их по очереди, чтобы посты не повторялись слово в слово.',
      `• Текст — до ${TEXT_MAX} знаков: длиннее Threads не принимает. Ссылку (на Google Play, на WhatsApp) пишите прямо в тексте.`,
      '• Фото или видео с подписью — это и файл, и текст.',
      `• Видео — от ${VIDEO_MIN_S} секунд до ${VIDEO_MAX_S / 60} минут и не тяжелее ${VIDEO_MAX_MB} МБ, лучше вертикальное 9:16: выйдет Reels в Instagram и роликом в Threads. Видео и фото выходят по очереди.`,
      '',
      fresh ? 'Когда всё пришлёте — «✅ Готово», дальше выберем расписание.' : 'Когда закончите — «✅ Готово».',
    ].join('\n'),
    extra: keyboard([[{ text: '✅ Готово', callback_data: cb('done', product.id) }, CANCEL]]),
  };
}

// Ответ на присланное. Альбом — это пачка сообщений, и на каждое фото по
// ответу было бы шумом: products.js собирает их и отвечает одним.
function savedView({ product, texts, photos, videos = 0, full = [] }) {
  const parts = [texts && `${texts} ${textsWord(texts)}`, photos && `${photos} фото`, videos && `${videos} видео`];
  const said = parts.filter(Boolean);
  const got = said.length > 1 ? `${said.slice(0, -1).join(', ')} и ${said.at(-1)}` : said.join('');
  const lines = [];
  if (got) lines.push(`✅ Сохранил ${got}. У «${name(product)}» теперь ${counts(product)}.`);
  if (full.includes('texts')) lines.push('⚠️ Текстов уже максимум — лишние не сохранил. Уберите ненужные в «📝 Тексты».');
  if (full.includes('photos')) lines.push('⚠️ Фото уже максимум — лишние не сохранил: больше Instagram в карусель не берёт.');
  if (full.includes('videos')) lines.push('⚠️ Видео уже максимум — лишние не сохранил. Уберите ненужные в «🎬 Видео».');
  lines.push('Ещё — присылайте, или «✅ Готово».');
  return {
    text: lines.join('\n'),
    extra: keyboard([[{ text: '✅ Готово', callback_data: cb('done', product.id) }]]),
  };
}

function tooLongText(length) {
  return `✂️ В тексте ${num(length)} знаков, а Threads принимает не больше ${TEXT_MAX}. Сократите и пришлите ещё раз — этот не сохранил.`;
}

// Почему видео не взяли. Telegram отдаёт боту файлы до 20 МБ, Threads берёт
// ролики до пяти минут, Instagram — Reels от трёх секунд.
const VIDEO_MAX_MB = 20;
const VIDEO_MAX_S = 300;
const VIDEO_MIN_S = 3;
function videoProblem({ size, duration }) {
  if (size > VIDEO_MAX_MB * 1024 * 1024) {
    return `🎬 Видео тяжелее ${VIDEO_MAX_MB} МБ Telegram боту не отдаёт — сожмите его и пришлите ещё раз.`;
  }
  if (duration > VIDEO_MAX_S) return '🎬 Видео длиннее 5 минут Threads не примет — укоротите и пришлите ещё раз.';
  if (duration && duration < VIDEO_MIN_S) return `🎬 Видео короче ${VIDEO_MIN_S} секунд Instagram в Reels не берёт.`;
  return '';
}

function result({ result: r, link }) {
  if (r.posted) return link ? `<a href="${tg.esc(link)}">вышел</a>` : 'вышел';
  return `не вышел: ${tg.esc(clamp(r.reason || 'причина неизвестна', 150))}`;
}

// Итог выхода продукта: что ушло и куда.
// media — что ушло вместе с текстом (см. mediaOf).
function publishedView({ product, textNo, media = { kind: 'photos' }, threads, instagram, notes = [] }) {
  const posted = threads.result.posted || instagram.result.posted;
  const clip = media.kind === 'video' ? `, видео №${media.index + 1}` : '';
  return {
    text: [
      `${posted ? '🛍' : '⚠️'} <b>${name(product)}</b> — текст №${textNo + 1}${clip}`,
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
  videosView,
  scheduleView,
  confirmDeleteView,
  namePrompt,
  contentPrompt,
  savedView,
  tooLongText,
  publishedView,
  summaryLine,
  everyText,
  mediaOf,
  videoProblem,
  TEXT_MAX,
  DAY_FROM,
  DAY_TO,
  WINDOW_MIN,
};

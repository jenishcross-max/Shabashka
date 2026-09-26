const { spawn } = require('child_process');
const { once } = require('events');
const { promises: fs } = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const card = require('./card');
const music = require('./music');
const { money } = require('../money');

// Бинарник ffmpeg приходит npm-пакетом под текущую платформу — на Render его
// нет в системе, а ставить через apt в бесплатном плане некуда.
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// Кадры отдаём ffmpeg сырыми пикселями в stdin, а не пишем PNG на диск: 270
// картинок по 3,7 МБ — это лишние полтора гигабайта записи и столько же чтения
// ради данных, которые живут доли секунды.
function render(args, renderer) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });

    let tail = '';
    proc.stderr.on('data', (chunk) => {
      tail = (tail + chunk).slice(-4000);
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg: ${tail.split('\n').filter(Boolean).slice(-3).join(' ').trim()}`));
    });

    // Если ffmpeg упал, недописанный кадр прилетит сюда как EPIPE. Настоящую
    // причину скажет stderr и код возврата, так что здесь просто молчим.
    proc.stdin.on('error', () => {});

    (async () => {
      for (let i = 0; i < renderer.frames; i++) {
        if (proc.exitCode !== null) return;
        // Ждём drain на каждом кадре: без этого Node сложит весь ролик в свою
        // очередь записи, и памяти уйдёт больше, чем весь лимит контейнера.
        if (!proc.stdin.write(renderer.frame(i / card.FPS))) await once(proc.stdin, 'drain');
      }
      proc.stdin.end();
    })().catch(() => {});
  });
}

// Сборки идут строго по одной. Админ публикует объявления пачкой, и два
// одновременных кодирования вместе с канвасами снова упёрлись бы в 512 МБ —
// а ждать тут нечего, ролик собирается за секунды.
let chain = Promise.resolve();

// items — [{ parsed, listingType }, ...]: в одном ролике едет несколько
// объявлений подряд (см. CARD_SECONDS в card.js). opts — название выпуска,
// см. createRenderer в card.js.
function build(items, opts) {
  const next = chain.then(() => encode(items, opts));
  chain = next.catch(() => {}); // провал одной сборки не должен рвать очередь
  return next;
}

// Возвращает { buffer, credit } — mp4 и строку об авторе трека для подписи к
// посту. Файл кладём во временную папку и убираем за собой: на Render диск
// эфемерный, но за время жизни процесса мусор бы копился.
async function encode(items, opts) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shabashka-reel-'));
  try {
    const out = path.join(dir, 'reel.mp4');
    const renderer = card.createRenderer(items, opts);
    const track = music.pick();

    const args = [
      '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba',
      '-s', `${card.W}x${card.H}`, '-r', String(card.FPS),
      '-i', 'pipe:0',
    ];

    if (track) {
      // Трек может быть короче ролика — зацикливаем и обрезаем по видео.
      args.push('-stream_loop', '-1', '-i', track.file);
    } else {
      // Instagram отклоняет ролики без звуковой дорожки, поэтому подкладываем тишину
      args.push('-f', 'lavfi', '-t', String(renderer.seconds),
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    }

    args.push(
      '-map', '0:v', '-map', '1:a',
      // Один поток вместо потока на ядро. libx264 держит свой набор буферов кадров
      // на каждый поток, а на 512 МБ бесплатного Render многопоточное кодирование
      // упирается в лимит памяти, и процесс убивают (137).
      '-threads', '1',
      '-c:v', 'libx264', '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p', '-r', String(card.FPS), '-g', String(card.FPS * 2),
      '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-ar', '44100', '-shortest',
      '-movflags', '+faststart'
    );

    if (track) {
      // Голоса в ролике нет, перекрывать музыке нечего — стоит она заметно
      // громче типичного фона. Треки в фонотеке уже выровнены по громкости при
      // нарезке, поэтому одного общего множителя хватает на всю папку.
      args.push('-af', `volume=0.8,afade=t=in:st=0:d=0.8,afade=t=out:st=${renderer.seconds - 1.2}:d=1.2`);
    }

    args.push(out);

    await render(args, renderer);
    return { buffer: await fs.readFile(out), credit: track ? track.credit : null };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Хэштеги по типу: под объявлением о продаже дома «#подработкабишкек» приводит
// не тех людей, а лента у нас общая — теги её и разделяют.
//
// Набор не фиксированный, а собирается каждый раз заново. Раньше под всеми
// постами одного типа стоял слово в слово один и тот же хвост, и вместе с
// одинаковым макетом это делало ленту машинной: у площадки есть, за что
// зацепиться, чтобы счесть аккаунт рассылкой. Два тега постоянные — по ним нас
// находят и по ним же лента остаётся узнаваемой, — остальные берутся из набора.
const CORE_TAGS = {
  order: ['#шабашка', '#подработкабишкек'],
  vacancy: ['#шабашка', '#вакансиибишкек'],
  board: ['#шабашка', '#объявлениябишкек'],
};

const TAG_POOL = {
  order: ['#работабишкек', '#жумуш', '#заказы', '#кыргызстан', '#бишкек', '#подработка', '#мастербишкек'],
  vacancy: ['#работабишкек', '#жумуш', '#кыргызстан', '#бишкек', '#вакансии', '#работавбишкеке', '#жумушбар'],
  board: ['#бишкек', '#кыргызстан', '#доскаобъявлений', '#жарнама', '#объявления', '#бишкекобъявления'],
};

// Сколько тегов добираем из набора сверх постоянных. Три-четыре: больше десятка
// тегов под постом сами по себе выглядят спамом, а Instagram давно не раздаёт
// показы за их количество.
const EXTRA_TAGS = 3;

// Случайные n штук из списка, не повторяясь. Перемешиваем копию: сам список
// общий на весь процесс, и портить его порядок нельзя.
function some(list, n) {
  const rest = [...list];
  const out = [];
  while (out.length < n && rest.length) {
    out.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
  }
  return out;
}

const oneOf = (list) => list[Math.floor(Math.random() * list.length)];

// Концовка подписи. Тоже вразнобой и по той же причине, что и теги: строка,
// повторённая слово в слово под сотней постов, — признак рассылки, а не
// объявления. Смысл у всех вариантов один: ссылка кликабельной в подписи
// Instagram не бывает, поэтому зовём в шапку профиля.
const CTA_LINES = [
  'Откликнуться — на Шабашка.com, ссылка в шапке профиля.',
  'Все объявления целиком — на Шабашка.com, ссылка в шапке профиля.',
  'Звоните по номеру выше или заходите на Шабашка.com — ссылка в шапке профиля.',
  'Больше заказов и вакансий — на Шабашка.com, ссылка в шапке профиля.',
  'Свежие объявления каждый день — Шабашка.com, ссылка в шапке профиля.',
];

function label(listingType) {
  if (listingType === 'vacancy') return '💼 Вакансия';
  if (listingType === 'board') return '📌 Объявление';
  return '🧰 Заказ';
}

// Строка «категория · город». У доски категории нет: она про работу, а там
// продают дом или сдают квартиру.
function metaLine(parsed, listingType) {
  return [listingType === 'board' ? '' : parsed.category, parsed.city].filter(Boolean).join(' · ');
}

// Сколько знаков описания оставляем каждому объявлению. У Instagram на всю
// подпись 2200 знаков: без потолка одно многословное объявление съело бы место
// у остальных. Потолок зависит от того, сколько их в ролике — в дайджесте их
// пять, и по 320 знаков на каждое подпись бы уже не влезла.
function descriptionLimit(count) {
  return count <= 3 ? 320 : Math.floor(900 / count);
}

function clampText(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

// Хэштеги — объединение по всем типам в ролике. Пачка собирается из одного
// типа, но повтор по типу первого объявления сломался бы молча, если когда-то
// в ролик поедет смесь.
function hashtagsFor(items) {
  const tags = new Set();
  for (const { listingType } of items) {
    const type = CORE_TAGS[listingType] ? listingType : 'order';
    for (const tag of CORE_TAGS[type]) tags.add(tag);
    for (const tag of some(TAG_POOL[type], EXTRA_TAGS)) tags.add(tag);
  }
  return [...tags].join(' ');
}

// Блок одного объявления в подписи. Адрес даём прямо здесь: ссылку Instagram
// кликабельной не делает ни в подписи, ни в комментариях, её набирают руками —
// а без адреса из ленты не найти именно это объявление среди трёх.
function captionBlock({ parsed, listingType, siteLink }, index, total) {
  const isVacancy = listingType === 'vacancy';
  const number = total > 1 ? `${index + 1}. ` : '';
  const lines = [`${number}${label(listingType)}: ${parsed.title || ''}`.trim()];

  const meta = metaLine(parsed, listingType);
  if (meta) lines.push(meta);
  if (parsed.budget) lines.push(`💰 ${money(parsed.budget)} сом${isVacancy ? ' (от)' : ''}`);
  // Телефон в подписи обязателен, если он есть: ссылки в Instagram не работают,
  // и без номера откликнуться прямо из ленты нечем.
  if (parsed.phone) lines.push(`📞 ${parsed.phone}`);
  if (parsed.description) lines.push(clampText(parsed.description, descriptionLimit(total)));
  if (siteLink) lines.push(siteLink);

  return lines.join('\n');
}

// Настройка, которую можно выключить. «Выключено» пишется словом — off (или
// пустым значением): Render не всегда даёт сохранить переменную без значения.
function optional(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = String(raw).trim();
  return /^(off|none|no|нет|-)$/i.test(value) ? '' : value;
}

// Пометка платного объявления первой строкой поста — «📣 Реклама». По
// умолчанию её нет: так решил владелец (сентябрь 2026), реклама выходит тем же
// видом, что и обычные объявления. Включается переменной AD_LABEL со словом
// пометки — например, AD_LABEL=Реклама. Стоит помнить, что правила Meta
// требуют отмечать оплаченное продвижение, а закон о рекламе — делать рекламу
// узнаваемой.
const AD_LABEL = optional('AD_LABEL', '');

function adLine() {
  return AD_LABEL ? `📣 ${AD_LABEL}` : '';
}

// Подпись под постом. items — [{ parsed, listingType, siteLink }, ...], те же
// объявления и в том же порядке, что и карточки в ролике.
function caption(items, credit, opts = {}) {
  // Шапка та же, что и на кадре: «Заказы дня · 31 июля». В ленте подпись видна
  // раньше, чем досмотрен ролик, и она должна называть выпуск так же.
  const lines = [
    `📋 ${opts.collection || card.collectionTitle(items[0] && items[0].listingType)} · ${opts.day || card.dayLabel()}`,
    '',
  ];
  if (opts.ad && adLine()) lines.unshift(adLine());
  lines.push(items.map((item, i) => captionBlock(item, i, items.length)).join('\n\n'));
  // Призыв тот же, что и на концовке ролика: у дайджеста он называет, сколько
  // всего объявлений ждёт на сайте, у обычного выпуска — просто зовёт откликнуться.
  lines.push(
    '',
    opts.cta
      ? `${opts.cta[0].toUpperCase()}${opts.cta.slice(1)} — Шабашка.com, ссылка в шапке профиля.`
      : oneOf(CTA_LINES)
  );
  // Автора трека называем обязательно: музыка в фонотеке под Creative Commons,
  // и указание автора — условие, на котором её вообще можно использовать.
  if (credit) lines.push('', credit);
  lines.push('', hashtagsFor(items));

  return lines.join('\n');
}

// В Threads пост не длиннее 500 знаков, причём эмодзи считаются байтами UTF-8,
// то есть за четыре. Кириллица идёт за символ, поэтому меряем именно так, а не
// по длине строки и не по всей длине в байтах.
function weight(text) {
  let n = 0;
  for (const ch of text) n += ch.codePointAt(0) > 0xffff ? Buffer.byteLength(ch) : 1;
  return n;
}

const THREADS_LIMIT = 500;

// Текст поста в Threads. От инстаграмной подписи отличается тремя вещами: он
// короче, в нём есть прямая ссылка на объявление — Threads делает ссылки
// кликабельными, поэтому звать в шапку профиля здесь незачем, — и в нём нет
// хештегов. Тег у Threads один на пост и уходит отдельным полем (см. cleanTag в
// threads.js); решётки в тексте, кроме первой, оставались просто словами и
// занимали место у описания.
function threadsText(parsed, listingType, siteLink, { ad = false } = {}) {
  const isVacancy = listingType === 'vacancy';
  const head = [`${label(listingType)}: ${parsed.title || ''}`.trim()];
  if (ad && adLine()) head.unshift(adLine());

  const meta = metaLine(parsed, listingType);
  if (meta) head.push(meta);
  if (parsed.budget) head.push(`💰 ${money(parsed.budget)} сом${isVacancy ? ' (от)' : ''}`);
  if (parsed.phone) head.push(`📞 ${parsed.phone}`);

  // Хвост собираем раньше описания: ссылка обязательна, а описание ужимается
  // под остаток.
  const tail = [];
  if (siteLink) tail.push(siteLink);

  const fixed = weight([...head, '', ...tail].join('\n'));
  // Блок описания добавляет к посту сам текст и два перевода строки — пустую
  // строку перед ним и ту, что отделит его от хвоста.
  const room = THREADS_LIMIT - fixed - 2;

  const body = [];
  if (parsed.description && room > 40) {
    let text = parsed.description;
    if (weight(text) > room) {
      // Режем по словам и добавляем многоточие — обрубок на середине слова
      // выглядит как сбой, а не как «дальше на сайте».
      while (text && weight(`${text}…`) > room) text = text.slice(0, -1).replace(/\s+\S*$/, '');
      text = text ? `${text}…` : '';
    }
    if (text) body.push('', text);
  }

  return [...head, ...body, ...(tail.length ? ['', ...tail] : [])].join('\n');
}

// Подпись к рекламе с готовым файлом — для Threads. Рекламу присылают как
// есть, и подпись у неё бывает на тысячу знаков, а Threads берёт пятьсот: пост
// с длинной подписью он просто отбивал, и реклама, за которую заплатили, не
// выходила туда вовсе. Поэтому режем описание по словам, а пометку рекламы и
// ссылку на карточку сохраняем целыми.
function threadsCaption(text, siteLink, { ad = false } = {}) {
  const head = ad && adLine() ? [adLine(), ''] : [];
  const tail = siteLink ? ['', siteLink] : [];
  const room = THREADS_LIMIT - weight([...head, ...tail].join('\n')) - 1;

  let body = String(text || '').trim();
  if (weight(body) > room) {
    body = body.slice(0, room);
    while (body && weight(`${body}…`) > room) body = body.slice(0, -1).replace(/\s+\S*$/, '');
    body = body ? `${body}…` : '';
  }
  return [...head, body, ...tail].join('\n').trim();
}

function fileName() {
  return `${crypto.randomBytes(12).toString('hex')}.mp4`;
}

module.exports = {
  build,
  caption,
  threadsText,
  adLine,
  optional,
  threadsCaption,
  weight,
  THREADS_LIMIT,
  fileName,
  COVER_MS: Math.round(card.COVER_AT * 1000),
};

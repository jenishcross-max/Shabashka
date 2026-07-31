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
// объявлений подряд (см. CARD_SECONDS в card.js).
function build(items) {
  const next = chain.then(() => encode(items));
  chain = next.catch(() => {}); // провал одной сборки не должен рвать очередь
  return next;
}

// Возвращает { buffer, credit } — mp4 и строку об авторе трека для подписи к
// посту. Файл кладём во временную папку и убираем за собой: на Render диск
// эфемерный, но за время жизни процесса мусор бы копился.
async function encode(items) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shabashka-reel-'));
  try {
    const out = path.join(dir, 'reel.mp4');
    const renderer = card.createRenderer(items);
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

// Заголовок объявления в подписи. Третий тип — «Объявление»: продажа, аренда,
// свои услуги. Работы там не предлагают, и называть такое заказом нельзя.
// Хэштеги по типу: под объявлением о продаже дома «#подработкабишкек» приводит
// не тех людей, а лента у нас общая — теги её и разделяют.
const HASHTAGS = {
  order: '#шабашка #работабишкек #жумуш #подработкабишкек #кыргызстан #заказы',
  vacancy: '#шабашка #работабишкек #жумуш #вакансиибишкек #кыргызстан',
  board: '#шабашка #бишкек #кыргызстан #объявлениябишкек #доскаобъявлений #жарнама',
};

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
// подпись 2200 знаков, а объявлений в ролике до трёх: без потолка одно
// многословное съело бы место у двух остальных.
const DESCRIPTION_LIMIT = 320;

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
    for (const tag of (HASHTAGS[listingType] || HASHTAGS.order).split(' ')) tags.add(tag);
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
  if (parsed.description) lines.push(clampText(parsed.description, DESCRIPTION_LIMIT));
  if (siteLink) lines.push(siteLink);

  return lines.join('\n');
}

// Подпись под постом. items — [{ parsed, listingType, siteLink }, ...], те же
// объявления и в том же порядке, что и карточки в ролике.
function caption(items, credit) {
  // Шапка та же, что и на кадре: «Заказы дня · 31 июля». В ленте подпись видна
  // раньше, чем досмотрен ролик, и она должна называть выпуск так же.
  const lines = [
    `📋 ${card.collectionTitle(items[0] && items[0].listingType)} · ${card.dayLabel()}`,
    '',
  ];
  lines.push(items.map((item, i) => captionBlock(item, i, items.length)).join('\n\n'));
  lines.push('', 'Откликнуться — на Шабашка.com, ссылка в шапке профиля.');
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

// В Threads тегов меньше: пост короткий, и каждый тег отбирает место у описания.
const THREADS_HASHTAGS = {
  order: '#шабашка #подработкабишкек #жумуш',
  vacancy: '#шабашка #вакансиибишкек #жумуш',
  board: '#шабашка #объявлениябишкек #кыргызстан',
};

// Текст поста в Threads. От инстаграмной подписи отличается двумя вещами:
// он короче и в нём есть прямая ссылка на объявление — Threads делает ссылки
// кликабельными, поэтому звать в шапку профиля здесь незачем.
function threadsText(parsed, listingType, siteLink, credit) {
  const isVacancy = listingType === 'vacancy';
  const head = [`${label(listingType)}: ${parsed.title || ''}`.trim()];

  const meta = metaLine(parsed, listingType);
  if (meta) head.push(meta);
  if (parsed.budget) head.push(`💰 ${money(parsed.budget)} сом${isVacancy ? ' (от)' : ''}`);
  if (parsed.phone) head.push(`📞 ${parsed.phone}`);

  // Хвост собираем раньше описания: ссылка, номер и указание автора трека
  // обязательны (последнее — условие лицензии на музыку), а описание ужимается
  // под остаток.
  const tail = [];
  if (siteLink) tail.push(siteLink);
  if (credit) tail.push(credit);
  tail.push(THREADS_HASHTAGS[listingType] || THREADS_HASHTAGS.order);

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

  return [...head, ...body, '', ...tail].join('\n');
}

function fileName() {
  return `${crypto.randomBytes(12).toString('hex')}.mp4`;
}

module.exports = {
  build,
  caption,
  threadsText,
  fileName,
  COVER_MS: Math.round(card.COVER_AT * 1000),
};

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

// Кадры для Instagram рисуем на канвасе, а не через ffmpeg drawtext: там пришлось
// бы экранировать чужой текст объявления (двоеточия, кавычки, проценты) и вручную
// считать переносы, не зная ширины строки. Канвас умеет измерять текст сам.
const W = 1080;
const H = 1920;

// @fontsource режет Roboto на subset-файлы, и в одну строку объявления попадают
// сразу три: латиница («Шабашка.com»), базовая кириллица и cyrillic-ext, где
// лежат кыргызские ө, ү, ң. Без последнего половина кыргызских слов — квадраты,
// поэтому шрифт всегда задаём списком, а не одним именем.
const FONT = 'RobotoCyr, RobotoCyrExt, RobotoLat';

const COLORS = {
  bg: '#fbf7f6',
  text: '#241a19',
  muted: '#7a6b69',
  body: '#4a3f3d',
  red: '#f0433e',
  redDark: '#d62d2a',
  border: '#efe3e1',
  white: '#ffffff',
};

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(path.dirname(require.resolve('@fontsource/roboto/package.json')), 'files');
  GlobalFonts.registerFromPath(path.join(dir, 'roboto-cyrillic-400-normal.woff2'), 'RobotoCyr');
  GlobalFonts.registerFromPath(path.join(dir, 'roboto-cyrillic-ext-400-normal.woff2'), 'RobotoCyrExt');
  GlobalFonts.registerFromPath(path.join(dir, 'roboto-latin-400-normal.woff2'), 'RobotoLat');
  GlobalFonts.registerFromPath(path.join(dir, 'roboto-cyrillic-700-normal.woff2'), 'RobotoCyrBold');
  GlobalFonts.registerFromPath(path.join(dir, 'roboto-cyrillic-ext-700-normal.woff2'), 'RobotoCyrExtBold');
  GlobalFonts.registerFromPath(path.join(dir, 'roboto-latin-700-normal.woff2'), 'RobotoLatBold');
  fontsReady = true;
}

const REGULAR = FONT;
const BOLD = 'RobotoCyrBold, RobotoCyrExtBold, RobotoLatBold';

// «2000» → «2 000»: на кадре цена крупная, и без разделителя разрядов её
// приходится пересчитывать глазами.
function money(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Переносы считаем по словам с реальной шириной глифов. Если текст не помещается
// в maxLines — обрезаем последнюю строку многоточием, а не даём ей уехать за край.
function wrap(ctx, text, maxWidth, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);

  const overflow = lines.length === maxLines && words.length > lines.join(' ').split(/\s+/).length;
  if (overflow) {
    let last = lines[lines.length - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1).trimEnd();
    }
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

// Первый кадр — само объявление. Телефон сюда намеренно не выносим: в ленте
// Instagram он живёт вечно и без ведома владельца, а на сайте показывается
// в контексте объявления, которое можно закрыть или удалить.
function renderListing(parsed, listingType) {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const pad = 96;
  const maxWidth = W - pad * 2;

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = 'top';
  let y = 190;

  // Плашка типа объявления
  const badge = listingType === 'vacancy' ? 'ВАКАНСИЯ' : 'ЗАКАЗ';
  ctx.font = `40px ${BOLD}`;
  const badgeWidth = ctx.measureText(badge).width + 64;
  ctx.fillStyle = COLORS.red;
  roundRect(ctx, pad, y, badgeWidth, 84, 42);
  ctx.fillStyle = COLORS.white;
  ctx.fillText(badge, pad + 32, y + 22);
  y += 84 + 64;

  // Заголовок
  ctx.font = `84px ${BOLD}`;
  ctx.fillStyle = COLORS.text;
  for (const line of wrap(ctx, parsed.title, maxWidth, 4)) {
    ctx.fillText(line, pad, y);
    y += 104;
  }
  y += 28;

  // Категория и город
  const meta = [parsed.category, parsed.city].filter(Boolean).join(' · ');
  if (meta) {
    ctx.font = `46px ${REGULAR}`;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(wrap(ctx, meta, maxWidth, 1)[0] || '', pad, y);
    y += 76;
  }

  // Цена — самое заметное на кадре: по ней в ленте решают, читать ли дальше.
  // У вакансии в этом поле нижняя граница зарплаты, поэтому и подпись другая.
  const isVacancy = listingType === 'vacancy';
  let price;
  if (parsed.budget) price = `${isVacancy ? 'от ' : ''}${money(parsed.budget)} сом`;
  else price = isVacancy ? 'Зарплата договорная' : 'Цена договорная';
  ctx.font = `92px ${BOLD}`;
  ctx.fillStyle = COLORS.red;
  ctx.fillText(price, pad, y);
  y += 132;

  ctx.fillStyle = COLORS.border;
  ctx.fillRect(pad, y, maxWidth, 3);
  y += 56;

  // Описание
  if (parsed.description) {
    ctx.font = `48px ${REGULAR}`;
    ctx.fillStyle = COLORS.body;
    for (const line of wrap(ctx, parsed.description, maxWidth, 7)) {
      ctx.fillText(line, pad, y);
      y += 66;
    }
  }

  // Подвал прибит к низу кадра, а не к концу текста: у объявлений разная длина,
  // и «плавающий» логотип в ленте выглядел бы как разные шаблоны.
  ctx.fillStyle = COLORS.text;
  ctx.fillRect(0, H - 260, W, 260);
  ctx.font = `64px ${BOLD}`;
  ctx.fillStyle = COLORS.white;
  ctx.fillText('Шабашка', pad, H - 190);
  ctx.fillStyle = COLORS.red;
  ctx.fillText('.com', pad + ctx.measureText('Шабашка').width, H - 190);
  ctx.font = `38px ${REGULAR}`;
  ctx.fillStyle = COLORS.muted;
  ctx.fillText('заказы и вакансии Кыргызстана', pad, H - 104);

  return canvas.toBuffer('image/png');
}

// Второй кадр — концовка, одинаковая для всех роликов: её задача не рассказать
// про заказ, а оставить в голове адрес сайта.
function renderOutro() {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = COLORS.red;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = `120px ${BOLD}`;
  ctx.fillStyle = COLORS.white;
  ctx.fillText('Шабашка.com', W / 2, H / 2 - 90);

  ctx.font = `76px ${REGULAR}`;
  ctx.fillText('найди работу', W / 2, H / 2 + 40);

  ctx.fillStyle = COLORS.white;
  roundRect(ctx, W / 2 - 260, H / 2 + 150, 520, 8, 4);

  ctx.font = `44px ${REGULAR}`;
  ctx.fillText('заказы и вакансии по всему Кыргызстану', W / 2, H / 2 + 240);

  return canvas.toBuffer('image/png');
}

module.exports = { renderListing, renderOutro, W, H };

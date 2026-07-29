const { createCanvas, GlobalFonts, Path2D } = require('@napi-rs/canvas');
const path = require('path');

// Кадры для Instagram рисуем на канвасе, а не через ffmpeg drawtext: там пришлось
// бы экранировать чужой текст объявления (двоеточия, кавычки, проценты) и вручную
// считать переносы, не зная ширины строки. Канвас умеет измерять текст сам.
//
// Верстаем в координатах 1080×1920, а холст держим 720×1280 и масштабируем весь
// контекст разом. Разметка кадра от этого не меняется, но пикселей вдвое меньше:
// ролик теперь не картинка, а тридцать кадров в секунду, и на бесплатном Render
// это разница между «собралось» и «убили по памяти». Reels принимает 720p.
const DW = 1080;
const DH = 1920;
const W = 720;
const H = 1280;
const SCALE = W / DW;

const FPS = 30;
const TOTAL_SECONDS = 9;
// Красный круг из центра закрывает объявление и открывает концовку — переход
// заметный, но дешёвый: одна дуга в клипе вместо второго слоя кадров.
const WIPE_AT = 6.2;
const WIPE_SECONDS = 0.55;

// @fontsource режет Roboto на subset-файлы, и в одну строку объявления попадают
// сразу три: латиница («Шабашка.com»), базовая кириллица и cyrillic-ext, где
// лежат кыргызские ө, ү, ң. Без последнего половина кыргызских слов — квадраты,
// поэтому шрифт всегда задаём списком, а не одним именем.
const REGULAR = 'RobotoCyr, RobotoCyrExt, RobotoLat';
const BOLD = 'RobotoCyrBold, RobotoCyrExtBold, RobotoLatBold';

const COLORS = {
  bg: '#fbf7f6',
  text: '#241a19',
  muted: '#7a6b69',
  body: '#4a3f3d',
  red: '#f0433e',
  border: '#efe3e1',
  white: '#ffffff',
};

const PAD = 96;
const MAXW = DW - PAD * 2;

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

// Логотип рисуем кодом, а не тянем frontend/public/logo.svg: там всего два
// «ш»-мазка на скруглённой плашке, а копия файла в бэкенде разъехалась бы с
// оригиналом при первой же правке фирменного стиля.
const LOGO_MARK = new Path2D('M30 32 V60 a10 10 0 0 0 20 0 V32 M50 32 V60 a10 10 0 0 0 20 0 V32');

function logo(ctx, x, y, size, plate, ink) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  ctx.fillStyle = plate;
  roundRect(ctx, 2, 2, 96, 96, 23);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(LOGO_MARK);
  ctx.restore();
}

// Доля прожитого у куска анимации, который начинается в start и длится dur.
const at = (t, start, dur) => Math.max(0, Math.min(1, (t - start) / dur));
const easeOut = (p) => 1 - (1 - p) ** 3;
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
// С перелётом: элемент проскакивает конечный размер и возвращается — так
// появление читается как «выскочило», а не «проявилось».
const easeBack = (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;

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

// Строка выезжает снизу и проявляется. Одна и та же повадка у заголовка,
// описания и подписей — разнобой в мелочах выглядел бы как сбой, а не как стиль.
function rise(ctx, text, x, y, p, shift = 44) {
  if (p <= 0) return;
  const e = easeOut(p);
  ctx.globalAlpha = e;
  ctx.fillText(text, x, y + (1 - e) * shift);
  ctx.globalAlpha = 1;
}

// Разметку считаем один раз на ролик: измерять текст на каждом из 270 кадров
// незачем, координаты от времени не зависят — от него зависит только подача.
function layout(ctx, parsed, listingType) {
  const isVacancy = listingType === 'vacancy';

  ctx.font = `40px ${BOLD}`;
  const badge = isVacancy ? 'ВАКАНСИЯ' : 'ЗАКАЗ';
  const badgeWidth = ctx.measureText(badge).width + 64;

  ctx.font = `84px ${BOLD}`;
  const title = wrap(ctx, parsed.title, MAXW, 4);

  ctx.font = `46px ${REGULAR}`;
  const metaText = [parsed.category, parsed.city].filter(Boolean).join(' · ');
  const meta = metaText ? wrap(ctx, metaText, MAXW, 1)[0] : '';

  ctx.font = `48px ${REGULAR}`;
  const description = parsed.description ? wrap(ctx, parsed.description, MAXW, 7) : [];

  // Цена — самое заметное на кадре: по ней в ленте решают, читать ли дальше.
  // У вакансии в этом поле нижняя граница зарплаты, поэтому и подпись другая.
  const amount = Number(String(parsed.budget || '').replace(/[^\d]/g, '')) || 0;

  let y = 190;
  const badgeY = y;
  y += 84 + 64;
  const titleY = y;
  y += 104 * title.length + 28;
  const metaY = y;
  if (meta) y += 76;
  const priceY = y;
  y += 132;
  const dividerY = y;
  y += 56;
  const descriptionY = y;

  return {
    badge, badgeWidth, badgeY,
    title, titleY,
    meta, metaY,
    amount,
    pricePrefix: isVacancy ? 'от ' : '',
    priceFallback: isVacancy ? 'Зарплата договорная' : 'Цена договорная',
    priceY,
    dividerY,
    description, descriptionY,
  };
}

function drawListing(ctx, l, t) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, DW, DH);

  // Два еле заметных красных пятна медленно плывут по фону. Без них девять
  // секунд неподвижного кремового поля в ленте читаются как зависшая картинка.
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = COLORS.red;
  ctx.beginPath();
  ctx.arc(180 + Math.sin(t * 0.5) * 60, 320 + Math.cos(t * 0.4) * 50, 300, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(920 + Math.cos(t * 0.45) * 70, 1180 + Math.sin(t * 0.55) * 60, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Медленный наезд на весь кадр: движение есть, а читать не мешает.
  ctx.save();
  const zoom = 1 + 0.035 * easeInOut(Math.min(1, t / WIPE_AT));
  ctx.translate(DW / 2, DH / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-DW / 2, -DH / 2);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Плашка типа объявления выезжает слева за край кадра
  const bp = at(t, 0.15, 0.5);
  if (bp > 0) {
    const e = easeOut(bp);
    ctx.globalAlpha = e;
    ctx.fillStyle = COLORS.red;
    roundRect(ctx, PAD - (1 - e) * (PAD + l.badgeWidth), l.badgeY, l.badgeWidth, 84, 42);
    ctx.fillStyle = COLORS.white;
    ctx.font = `40px ${BOLD}`;
    ctx.fillText(l.badge, PAD - (1 - e) * (PAD + l.badgeWidth) + 32, l.badgeY + 22);
    ctx.globalAlpha = 1;
  }

  // Заголовок — строка за строкой, а не разом: взгляд успевает зацепиться
  ctx.font = `84px ${BOLD}`;
  ctx.fillStyle = COLORS.text;
  l.title.forEach((line, i) => rise(ctx, line, PAD, l.titleY + i * 104, at(t, 0.45 + i * 0.12, 0.5)));

  if (l.meta) {
    ctx.font = `46px ${REGULAR}`;
    ctx.fillStyle = COLORS.muted;
    rise(ctx, l.meta, PAD, l.metaY, at(t, 0.95, 0.5));
  }

  // Цена выскакивает и досчитывается до своей суммы — на этом кадре взгляд
  // и должен остановиться.
  const pp = at(t, 1.15, 0.6);
  if (pp > 0) {
    const count = easeOut(at(t, 1.15, 0.9));
    const price = l.amount
      ? `${l.pricePrefix}${money(Math.round((l.amount * count) / 10) * 10)} сом`
      : l.priceFallback;
    ctx.save();
    ctx.font = `92px ${BOLD}`;
    ctx.fillStyle = COLORS.red;
    ctx.globalAlpha = Math.min(1, pp * 2);
    ctx.translate(PAD, l.priceY + 46);
    const s = 0.75 + easeBack(pp) * 0.25;
    ctx.scale(s, s);
    ctx.fillText(price, 0, -46);
    ctx.restore();
  }

  // Линейка прочерчивается слева направо
  const dp = at(t, 1.5, 0.5);
  if (dp > 0) {
    ctx.fillStyle = COLORS.border;
    ctx.fillRect(PAD, l.dividerY, MAXW * easeOut(dp), 3);
  }

  ctx.font = `48px ${REGULAR}`;
  ctx.fillStyle = COLORS.body;
  l.description.forEach((line, i) =>
    rise(ctx, line, PAD, l.descriptionY + i * 66, at(t, 1.75 + i * 0.09, 0.45), 30)
  );

  // Подвал прибит к низу кадра, а не к концу текста: у объявлений разная длина,
  // и «плавающий» логотип в ленте выглядел бы как разные шаблоны.
  const fp = at(t, 2.3, 0.6);
  if (fp > 0) {
    const e = easeOut(fp);
    ctx.save();
    ctx.translate(0, (1 - e) * 260);
    ctx.fillStyle = COLORS.text;
    ctx.fillRect(0, DH - 260, DW, 260);

    const lp = at(t, 2.6, 0.6);
    if (lp > 0) {
      ctx.save();
      ctx.translate(PAD + 66, DH - 260 + 130);
      ctx.scale(easeBack(lp), easeBack(lp));
      ctx.rotate((1 - easeOut(lp)) * -0.4);
      logo(ctx, -66, -66, 132, COLORS.red, COLORS.white);
      ctx.restore();
    }

    const textX = PAD + 132 + 36;
    ctx.font = `64px ${BOLD}`;
    ctx.fillStyle = COLORS.white;
    ctx.fillText('Шабашка', textX, DH - 190);
    ctx.fillStyle = COLORS.red;
    ctx.fillText('.com', textX + ctx.measureText('Шабашка').width, DH - 190);
    ctx.font = `38px ${REGULAR}`;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText('заказы и вакансии Кыргызстана', textX, DH - 104);
    ctx.restore();
  }

  ctx.restore();
}

// Концовка одинаковая для всех роликов: её задача не рассказать про заказ,
// а оставить в голове адрес сайта. t здесь — время от начала перехода.
function drawOutro(ctx, t) {
  ctx.fillStyle = COLORS.red;
  ctx.fillRect(0, 0, DW, DH);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const float = Math.sin(t * 1.8) * 12;

  const lp = at(t, 0.2, 0.7);
  if (lp > 0) {
    ctx.save();
    ctx.translate(DW / 2, DH / 2 - 380 + float);
    ctx.scale(easeBack(lp), easeBack(lp));
    ctx.rotate((1 - easeOut(lp)) * 0.5);
    ctx.globalAlpha = Math.min(1, lp * 2);
    logo(ctx, -130, -130, 260, COLORS.white, COLORS.red);
    ctx.restore();
  }

  ctx.fillStyle = COLORS.white;
  ctx.font = `120px ${BOLD}`;
  rise(ctx, 'Шабашка.com', DW / 2, DH / 2 - 40 + float * 0.4, at(t, 0.5, 0.6));

  ctx.font = `76px ${REGULAR}`;
  rise(ctx, 'найди работу', DW / 2, DH / 2 + 90, at(t, 0.7, 0.6));

  const up = at(t, 0.9, 0.6);
  if (up > 0) {
    const w = 520 * easeOut(up);
    roundRect(ctx, DW / 2 - w / 2, DH / 2 + 200, w, 8, 4);
  }

  // Строка снизу тихо пульсирует — единственный призыв к действию в ролике,
  // и он должен доживать до конца кадра, а не потеряться в красном поле.
  const cp = at(t, 1.1, 0.6);
  if (cp > 0) {
    ctx.globalAlpha = easeOut(cp) * (0.78 + Math.sin(t * 3) * 0.18);
    ctx.font = `44px ${REGULAR}`;
    ctx.fillText('заказы и вакансии по всему Кыргызстану', DW / 2, DH / 2 + 290);
    ctx.globalAlpha = 1;
  }
}

// Отдаёт кадры одного ролика. Холст один на всю сборку и перерисовывается на
// месте: 270 отдельных канвасов по 3,7 МБ бесплатный Render не переживёт.
function createRenderer(parsed, listingType) {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const l = layout(ctx, parsed, listingType);

  return {
    frames: Math.round(TOTAL_SECONDS * FPS),
    frame(t) {
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      drawListing(ctx, l, t);

      const wipe = at(t, WIPE_AT, WIPE_SECONDS);
      if (wipe > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(DW / 2, DH / 2, easeInOut(wipe) * Math.hypot(DW, DH) * 0.53, 0, Math.PI * 2);
        ctx.clip();
        drawOutro(ctx, t - WIPE_AT);
        ctx.restore();
      }

      // data() отдаёт вид на пиксели самого холста, а поток пишет буфер не
      // сразу — без копии следующий кадр затёр бы ещё не ушедший в ffmpeg.
      return Buffer.from(canvas.data());
    },
  };
}

module.exports = { createRenderer, W, H, FPS, TOTAL_SECONDS };

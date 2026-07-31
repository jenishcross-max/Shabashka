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
// В один ролик кладём несколько объявлений: у Instagram квота 25 публикаций в
// сутки на аккаунт, и она считается по постам, а не по объявлениям — три
// карточки в ролике втрое поднимают дневную пропускную способность, ничего не
// обходя. Времени на карточку столько, чтобы к её концу всё было не только
// нарисовано (последняя анимация заканчивается к 3,3 с), но и прочитано.
const CARD_SECONDS = 5.6;
const OUTRO_SECONDS = 2.8;
// Красный круг из центра закрывает объявление и открывает концовку — переход
// заметный, но дешёвый: одна дуга в клипе вместо второго слоя кадров. Тем же
// кругом карточки сменяют друг друга: своя повадка у каждого перехода читалась
// бы как склейка разных роликов.
const WIPE_SECONDS = 0.55;

const totalSeconds = (count) => count * CARD_SECONDS + OUTRO_SECONDS;
// С какой секунды Instagram берёт картинку для сетки профиля. По умолчанию он
// взял бы первый кадр, а там объявление ещё не выехало — в профиле висел бы
// пустой кремовый прямоугольник. К 3.6 с нарисовано уже всё, включая подвал.
const COVER_AT = 3.6;

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

// Каждой категории — свой акцент. Красный остаётся фирменным и держит концовку
// и логотип, но если все ролики подряд красно-кремовые, лента выглядит как один
// зависший кадр. Цвет выбирается по имени категории, а не по её номеру в базе:
// категории администратор добавляет и удаляет, и от сдвига списка у «Ремонта»
// не должен меняться цвет.
const ACCENTS = [
  '#f0433e', '#f97316', '#d97706', '#16a34a',
  '#0d9488', '#2563eb', '#4f46e5', '#7c3aed', '#db2777',
];

function accentFor(category) {
  const key = String(category || '');
  if (!key) return ACCENTS[0];
  // Множитель 37 подобран перебором по девяти категориям из defaultCategories:
  // на нём восемь из них получают разные цвета, на привычном 31 — только пять.
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 37 + key.charCodeAt(i)) % 100000;
  return ACCENTS[hash % ACCENTS.length];
}

// Ролик — не случайная тройка объявлений, а выпуск за число: в одну пачку
// собираются объявления одного типа, и шапка называет их так, как назвал бы
// человек. У доски в шапке «объявления», а не «доска №6»: номер доски объясняет,
// куда кликать на сайте, и на плашке он к месту, а в заголовке выпуска — нет.
const COLLECTIONS = {
  vacancy: 'Вакансии дня',
  order: 'Заказы дня',
  board: 'Объявления дня',
};

const collectionTitle = (listingType) => COLLECTIONS[listingType] || COLLECTIONS.order;

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

// «31 июля» по бишкекскому времени. Render живёт по UTC, и объявление,
// опубликованное в час ночи, ушло бы в ролик вчерашним числом. Бишкек круглый
// год UTC+6 и часы не переводит, поэтому хватает сдвига — тянуть базу часовых
// поясов ради одной строки незачем. Месяц берём из своего списка, а не из Intl:
// нужен родительный падеж («31 июля», не «31 июль»), и он не должен зависеть
// от того, с какой сборкой ICU собран Node на площадке.
const BISHKEK_OFFSET_MS = 6 * 60 * 60 * 1000;

function dayLabel(now = Date.now()) {
  const d = new Date(now + BISHKEK_OFFSET_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// Полупрозрачные заливки задаём через rgba: холст не умеет складывать hex с
// альфой в градиентах, а globalAlpha пришлось бы возвращать после каждой фигуры.
function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

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
const { money } = require('../money');

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
function layout(ctx, parsed, listingType, index, total) {
  const isVacancy = listingType === 'vacancy';

  ctx.font = `40px ${BOLD}`;
  // То, что не заказ и не вакансия, — продажа, аренда, свои услуги — уходит на
  // доску №6. Плашка называет её по номеру, а не словом «объявление»: так короче
  // и сразу понятно, куда кликать на сайте.
  const isBoard = listingType === 'board';
  const badge = isVacancy ? 'ВАКАНСИЯ' : isBoard ? 'ДОСКА №6' : 'ЗАКАЗ';
  const badgeWidth = ctx.measureText(badge).width + 64;
  // У доски свой синий цвет вместо категорийного акцента — на ней вперемешку
  // жильё, техника и услуги без общей категории, и плашка не должна прыгать по
  // цвету от объявления к объявлению.
  const badgeAccent = isBoard ? '#2563eb' : null;

  ctx.font = `84px ${BOLD}`;
  const title = wrap(ctx, parsed.title, MAXW, 4);

  ctx.font = `46px ${REGULAR}`;
  // Категорию у доски не показываем: там продают дом и сдают квартиру, а категории
  // у нас про работу — «Другое · Бишкек» на кадре только сбивало бы с толку.
  const metaText = [listingType === 'board' ? '' : parsed.category, parsed.city]
    .filter(Boolean)
    .join(' · ');
  const meta = metaText ? wrap(ctx, metaText, MAXW, 1)[0] : '';

  ctx.font = `48px ${REGULAR}`;
  const description = parsed.description ? wrap(ctx, parsed.description, MAXW, 6) : [];

  // Цена — самое заметное на кадре: по ней в ленте решают, читать ли дальше.
  // У вакансии в этом поле нижняя граница зарплаты, поэтому и подпись другая.
  const amount = Number(String(parsed.budget || '').replace(/[^\d]/g, '')) || 0;
  const pricePrefix = isVacancy ? 'от ' : '';
  const priceFallback = isVacancy ? 'Зарплата договорная' : 'Цена договорная';

  // Плашку под ценой меряем по конечной сумме и держим неподвижной: цифры на
  // кадре досчитываются, и плашка по ширине текста дёргалась бы все полсекунды.
  ctx.font = `92px ${BOLD}`;
  const priceFinal = amount ? `${pricePrefix}${money(amount)} сом` : priceFallback;
  const priceWidth = Math.min(MAXW, ctx.measureText(priceFinal).width + 64);

  // В сетке профиля Instagram показывает не весь кадр, а 4:5 из его середины —
  // сверху и снизу срезается по 285 точек. Поэтому блок начинаем ниже: при
  // старте с 190 плашка «ЗАКАЗ» в сетку уже не попадала.
  let y = 300;
  const badgeY = y;
  y += 84 + 64;
  const titleY = y;
  y += 104 * title.length + 28;
  const metaY = y;
  if (meta) y += 76;
  const priceY = y;
  y += 156;
  const dividerY = y;
  y += 56;
  const descriptionY = y;

  return {
    accent: accentFor(parsed.category),
    index, total,
    badge, badgeWidth, badgeAccent, badgeY,
    title, titleY,
    meta, metaY,
    amount, pricePrefix, priceFallback, priceWidth,
    priceY,
    dividerY,
    description, descriptionY,
  };
}

// Мягкое пятно света: радиальный градиент вместо плоского круга. Круг с
// globalAlpha давал заметную границу — на кремовом фоне она читалась как
// дефект сжатия, а не как задумка.
function glow(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// t — время от начала своей карточки, progress — доля всего ролика: полоска
// вверху показывает, сколько осталось до конца видео, а не до конца карточки.
function drawListing(ctx, l, t, progress) {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, DW, DH);

  // Фон уводим по диагонали в цвет категории — сверху почти белый, внизу
  // подкрашенный. Кадр перестаёт быть плоским, а текст поверх не страдает:
  // максимум насыщенности здесь 12%.
  const wash = ctx.createLinearGradient(DW, 0, 0, DH);
  wash.addColorStop(0, rgba(COLORS.white, 0.7));
  wash.addColorStop(0.5, rgba(l.accent, 0.03));
  wash.addColorStop(1, rgba(l.accent, 0.12));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, DW, DH);

  // Три пятна медленно плывут по фону. Без них девять секунд неподвижного
  // поля в ленте читаются как зависшая картинка.
  glow(ctx, 180 + Math.sin(t * 0.5) * 60, 300 + Math.cos(t * 0.4) * 50, 420, l.accent, 0.16);
  glow(ctx, 920 + Math.cos(t * 0.45) * 70, 1180 + Math.sin(t * 0.55) * 60, 380, l.accent, 0.13);
  glow(ctx, 620 + Math.sin(t * 0.3 + 2) * 90, 1750 + Math.cos(t * 0.35) * 40, 340, COLORS.red, 0.08);

  // Два тонких кольца крутятся вокруг кадра — движение, которое видно боковым
  // зрением и не мешает читать.
  ctx.save();
  ctx.strokeStyle = rgba(l.accent, 0.14);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(940 + Math.cos(t * 0.6) * 40, 620 + Math.sin(t * 0.6) * 40, 300, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(120 + Math.sin(t * 0.5) * 50, 1480 + Math.cos(t * 0.5) * 50, 240, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Полоска прогресса вверху: в ленте она подсказывает, что ролик короткий и
  // досмотреть его — секунды.
  ctx.fillStyle = rgba(l.accent, 0.15);
  ctx.fillRect(0, 0, DW, 10);
  ctx.fillStyle = l.accent;
  ctx.fillRect(0, 0, DW * Math.min(1, progress), 10);

  // Шапка выпуска: «ВАКАНСИИ ДНЯ» слева, число справа. Рисуем её до наезда и
  // не трогаем зумом — она должна стоять неподвижно, как полоска прогресса:
  // это рамка ролика, а не часть карточки. По той же причине она переживает
  // смену карточек без анимации появления, только с общим проявлением в начале.
  const hp = at(t, 0.05, 0.5);
  if (hp > 0) {
    const e = easeOut(hp);
    ctx.save();
    ctx.globalAlpha = e;
    ctx.translate(0, (1 - e) * -24);
    ctx.fillStyle = rgba(l.accent, 0.1);
    ctx.fillRect(0, 10, DW, 118);
    ctx.fillStyle = rgba(l.accent, 0.28);
    ctx.fillRect(0, 126, DW, 2);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `44px ${BOLD}`;
    ctx.fillStyle = l.accent;
    ctx.fillText(l.collection.toUpperCase(), PAD, 70);

    ctx.textAlign = 'right';
    ctx.font = `44px ${REGULAR}`;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(l.day, DW - PAD, 70);
    ctx.restore();
  }

  // Медленный наезд на весь кадр: движение есть, а читать не мешает.
  ctx.save();
  const zoom = 1 + 0.035 * easeInOut(Math.min(1, t / CARD_SECONDS));
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
    ctx.fillStyle = l.badgeAccent || l.accent;
    roundRect(ctx, PAD - (1 - e) * (PAD + l.badgeWidth), l.badgeY, l.badgeWidth, 84, 42);
    ctx.fillStyle = COLORS.white;
    ctx.font = `40px ${BOLD}`;
    ctx.fillText(l.badge, PAD - (1 - e) * (PAD + l.badgeWidth) + 32, l.badgeY + 22);
    ctx.globalAlpha = 1;

    // «1 / 3» на другом краю той же строки. Без счётчика зритель не знает, что
    // за первым объявлением будет ещё два, и уходит с ролика на середине.
    if (l.total > 1) {
      ctx.save();
      ctx.globalAlpha = e;
      ctx.textAlign = 'right';
      ctx.font = `40px ${BOLD}`;
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(`${l.index + 1} / ${l.total}`, DW - PAD, l.badgeY + 22);
      ctx.restore();
    }
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
  // и должен остановиться. Поэтому она лежит на плашке цвета категории:
  // белым по цветному она заметна даже в превью размером с ноготь.
  const pp = at(t, 1.15, 0.6);
  if (pp > 0) {
    const count = easeOut(at(t, 1.15, 0.9));
    const price = l.amount
      ? `${l.pricePrefix}${money(Math.round((l.amount * count) / 10) * 10)} сом`
      : l.priceFallback;
    ctx.save();
    ctx.globalAlpha = Math.min(1, pp * 2);
    // Масштабируем от левого края плашки, а не от её середины: иначе на выезде
    // текст уезжал бы за отступ кадра.
    ctx.translate(PAD, l.priceY + 62);
    const s = 0.75 + easeBack(pp) * 0.25;
    ctx.scale(s, s);
    // «Цена договорная» — не сумма, и заливать её тем же плотным цветом нельзя:
    // она кричала бы громче заголовка. Ей достаётся бледная плашка с цветным
    // текстом, настоящей цене — сплошная с белым.
    ctx.fillStyle = l.amount ? l.accent : rgba(l.accent, 0.12);
    roundRect(ctx, 0, -62, l.priceWidth, 124, 30);
    ctx.font = `92px ${BOLD}`;
    ctx.fillStyle = l.amount ? COLORS.white : l.accent;
    ctx.fillText(price, 32, -46);
    ctx.restore();
  }

  // Линейка прочерчивается слева направо и гаснет к правому краю
  const dp = at(t, 1.5, 0.5);
  if (dp > 0) {
    const line = ctx.createLinearGradient(PAD, 0, PAD + MAXW, 0);
    line.addColorStop(0, rgba(l.accent, 0.55));
    line.addColorStop(1, rgba(l.accent, 0));
    ctx.fillStyle = line;
    ctx.fillRect(PAD, l.dividerY, MAXW * easeOut(dp), 4);
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
    // Кант цвета категории по верхней кромке подвала — он связывает тёмную
    // плашку с остальным кадром, иначе она выглядит приклеенной из другого макета.
    ctx.fillStyle = l.accent;
    ctx.fillRect(0, DH - 260, DW, 6);

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
  // Красный с подсветкой за логотипом вместо ровной заливки: центр кадра
  // становится светлее краёв, и взгляд сам идёт туда, где название сайта.
  ctx.fillStyle = '#d9312c';
  ctx.fillRect(0, 0, DW, DH);
  const bg = ctx.createRadialGradient(DW / 2, DH / 2 - 260, 0, DW / 2, DH / 2 - 260, DH * 0.72);
  bg.addColorStop(0, '#ff6a5c');
  bg.addColorStop(0.55, rgba(COLORS.red, 0.55));
  bg.addColorStop(1, rgba(COLORS.red, 0));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, DW, DH);

  // Светлые точки всплывают снизу вверх и по кругу уходят обратно. Считаются
  // формулой, а не хранятся массивом: восемнадцать чисел на кадр дешевле, чем
  // состояние, которое надо тащить между кадрами.
  for (let i = 0; i < 18; i += 1) {
    const seed = i * 137.5;
    const x = (Math.sin(seed) * 0.5 + 0.5) * DW;
    const y = (DH * 1.05 - ((t * 90 + i * 210) % (DH * 1.2))) + Math.sin(t + i) * 20;
    const r = 5 + (i % 4) * 5;
    ctx.fillStyle = rgba(COLORS.white, 0.06 + (i % 3) * 0.05);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

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

// Круг из центра, которым одна сцена съедает другую. Всё, что нарисует draw,
// видно только внутри круга — то, что было на холсте, остаётся по краям.
function wipeIn(ctx, p, draw) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(DW / 2, DH / 2, easeInOut(p) * Math.hypot(DW, DH) * 0.53, 0, Math.PI * 2);
  ctx.clip();
  draw();
  ctx.restore();
}

// Отдаёт кадры ролика. items — [{ parsed, listingType }, ...]: объявления идут
// одно за другим, каждое своей карточкой, и общая концовка в конце. Холст один
// на всю сборку и перерисовывается на месте: полтысячи отдельных канвасов по
// 3,7 МБ бесплатный Render не переживёт.
function createRenderer(items) {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  // Заголовок выпуска берём по первому объявлению: пачка собирается из одного
  // типа (см. очереди в social/index.js), так что он общий на весь ролик.
  const collection = collectionTitle(items[0] && items[0].listingType);
  const day = dayLabel();
  const cards = items.map(({ parsed, listingType }, i) => ({
    ...layout(ctx, parsed, listingType, i, items.length),
    collection,
    day,
  }));

  const outroAt = cards.length * CARD_SECONDS;
  const seconds = totalSeconds(cards.length);

  return {
    seconds,
    frames: Math.round(seconds * FPS),
    frame(t) {
      ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
      const progress = Math.min(1, t / seconds);

      if (t >= outroAt) {
        // Под кругом остаётся застывший последний кадр карточки, а не пустота.
        drawListing(ctx, cards[cards.length - 1], CARD_SECONDS, progress);
        wipeIn(ctx, at(t, outroAt, WIPE_SECONDS), () => drawOutro(ctx, t - outroAt));
      } else {
        const idx = Math.floor(t / CARD_SECONDS);
        const local = t - idx * CARD_SECONDS;
        if (idx > 0 && local < WIPE_SECONDS) {
          // Переход между объявлениями: предыдущее ещё на экране, новое
          // проступает изнутри и там же начинает свои появления с нуля.
          drawListing(ctx, cards[idx - 1], CARD_SECONDS, progress);
          wipeIn(ctx, local / WIPE_SECONDS, () => drawListing(ctx, cards[idx], local, progress));
        } else {
          drawListing(ctx, cards[idx], local, progress);
        }
      }

      // data() отдаёт вид на пиксели самого холста, а поток пишет буфер не
      // сразу — без копии следующий кадр затёр бы ещё не ушедший в ffmpeg.
      return Buffer.from(canvas.data());
    },
  };
}

module.exports = {
  createRenderer, totalSeconds, collectionTitle, dayLabel, W, H, FPS, COVER_AT,
};

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

// Golos Text вместо Roboto. Roboto — системный шрифт Android, и кадр с ним
// выглядит не свёрстанным, а собранным по умолчанию. Golos рисовали под русский
// и кириллицу, у него плотнее очко и есть 800-й вес: заголовок объявления при
// том же кегле весит заметно больше. Из кириллических бесплатных он единственный
// из проверенных (Onest, Manrope) закрывает кыргызские ө, ү и ң целиком.
//
// @fontsource режет шрифт на subset-файлы, и в одну строку объявления попадают
// сразу три: латиница («Шабашка.com»), базовая кириллица и cyrillic-ext, где
// эти самые ө, ү, ң и лежат. Без последнего половина кыргызских слов — квадраты,
// поэтому шрифт всегда задаём списком, а не одним именем.
const REGULAR = 'GolosCyr, GolosExt, GolosLat';
// Полужирный — для мелких строк вроде плашки «ВАКАНСИЯ» и счётчика: 800-й вес
// на 40-м кегле слипается в пятно.
const SEMI = 'GolosCyrSemi, GolosExtSemi, GolosLatSemi';
const BOLD = 'GolosCyrBold, GolosExtBold, GolosLatBold';

const COLORS = {
  // Тёплая бумага, а не белый лист: на белом кремовый колонтитул и чёрная
  // типографика выглядят распечаткой, на бумаге — журнальной полосой.
  bg: '#f4f1ec',
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

// Последняя строка концовки. У обычного выпуска она про сайт вообще, у
// дайджеста её подменяют на «и ещё 37 вакансий на сайте» — см. digestRepo.cta.
const DEFAULT_CTA = 'заказы и вакансии по всему Кыргызстану';

// Полупрозрачные заливки задаём через rgba: холст не умеет складывать hex с
// альфой в градиентах, а globalAlpha пришлось бы возвращать после каждой фигуры.
function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Кадр набран как журнальная полоса: объявление лежит прямо на бумаге, а не на
// карточке поверх цветного фона. Держат его не плашки, а типографика и линейки —
// цветной колонтитул во всю ширину сверху, жирная линейка под шапкой, ценник в
// рамке, номер выпуска гигантом на полях. Так кадр читается как страница, а не
// как слайд из конструктора, и цвет остаётся акцентом, а не заливкой.
const PAD = 88;
const MAXW = DW - PAD * 2;

// Instagram кладёт поверх ролика свои кнопки: сверху — имя аккаунта и «...»,
// снизу — подпись, лайки, «Подписаться». Всё, что должно читаться, живёт между
// этими полосами: колонтитул начинается не у кромки кадра, а на SAFE_TOP.
const SAFE_TOP = 250;
const HEAD_H = 104;
const HEAD_BOTTOM = SAFE_TOP + HEAD_H;
// Ниже FOOTER_TOP — подвал с адресом сайта; его нижние 180 точек уходят под
// подпись Instagram, поэтому логотип и строки прижаты к его верхнему краю.
const FOOTER_H = 440;
const FOOTER_TOP = DH - FOOTER_H;

// Вертикаль полосы: капс-строка, жирная линейка, заголовок — и дальше по тексту.
const META_TOP = 452;
const RULE_Y = 520;
const BODY_TOP = 570;
const TITLE_LINE = 114;
const LINE = 66;
// Докуда можно опускать описание, чтобы оно не влезло в подвал.
const TEXT_BOTTOM = FOOTER_TOP - 40;

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(
    path.dirname(require.resolve('@fontsource/golos-text/package.json')), 'files');
  const weights = { 400: '', 600: 'Semi', 800: 'Bold' };
  const subsets = { cyrillic: 'GolosCyr', 'cyrillic-ext': 'GolosExt', latin: 'GolosLat' };
  for (const [subset, family] of Object.entries(subsets)) {
    for (const [weight, suffix] of Object.entries(weights)) {
      GlobalFonts.registerFromPath(
        path.join(dir, `golos-text-${subset}-${weight}-normal.woff2`), family + suffix);
    }
  }
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

function roundRect(ctx, x, y, w, h, r, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (stroke) ctx.stroke();
  else ctx.fill();
}

// Капс без разрядки слипается в сплошной забор, и «ВАКАНСИЯ · ТРАНСПОРТ ·
// БИШКЕК» читается одним длинным словом. Канвас межбуквенного интервала не
// умеет, поэтому строку рисуем по букве.
function tracked(ctx, text, x, y, extra) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + extra;
  }
}

const trackedWidth = (ctx, text, extra) =>
  [...text].reduce((w, ch) => w + ctx.measureText(ch).width + extra, 0) - extra;

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
  // То, что не заказ и не вакансия, — продажа, аренда, свои услуги — уходит на
  // доску №6. Называем её по номеру, а не словом «объявление»: так короче и
  // сразу понятно, куда кликать на сайте.
  const isBoard = listingType === 'board';
  const badge = isVacancy ? 'ВАКАНСИЯ' : isBoard ? 'ДОСКА №6' : 'ЗАКАЗ';

  // У доски свой синий вместо категорийного акцента: там вперемешку жильё,
  // техника и услуги без общей категории, и кадр не должен прыгать по цвету от
  // объявления к объявлению.
  const accent = isBoard ? '#2563eb' : accentFor(parsed.category);

  // Категория и город — одной капс-строкой над заголовком, как рубрика в
  // журнале. Тип объявления в неё не берём: «ВАКАНСИЯ» под колонтитулом
  // «ТОП-5 ВАКАНСИЙ» — это одно и то же слово дважды, и из-за него в строку
  // переставала влезать категория. У доски наоборот: категорию не показываем
  // (там продают дом и сдают квартиру, а категории у нас про работу), и номер
  // доски остаётся единственным, что объясняет, куда кликать на сайте.
  ctx.font = `36px ${SEMI}`;
  const metaParts = [isBoard ? badge : parsed.category, parsed.city].filter(Boolean);
  let meta = metaParts.join(' · ').toUpperCase();
  // Если рубрика с разрядкой не влезает — выкидываем среднюю часть целиком, а не
  // режем многоточием: обрубок капса выглядит как сбой вёрстки. Справа от неё
  // ещё стоит счётчик, поэтому меряем не по всей ширине полосы.
  while (metaParts.length > 1 && trackedWidth(ctx, meta, 5) > MAXW - 170) {
    metaParts.splice(-2, 1);
    meta = metaParts.join(' · ').toUpperCase();
  }

  ctx.font = `104px ${BOLD}`;
  const title = wrap(ctx, parsed.title, MAXW, 4);

  // Цена — самое заметное на кадре: по ней в ленте решают, читать ли дальше.
  // У вакансии в этом поле нижняя граница зарплаты, поэтому и подпись другая.
  const amount = Number(String(parsed.budget || '').replace(/[^\d]/g, '')) || 0;
  const pricePrefix = isVacancy ? 'от ' : '';
  // «Зарплата договорная» набранная крупным кеглем шире полосы, и рамка
  // упиралась в поля. Сокращаем — «з/п» на объявлении о работе читается
  // однозначно.
  const priceFallback = isVacancy ? 'З/п договорная' : 'Цена договорная';

  // Рамку ценника меряем по конечной сумме и держим неподвижной: цифры на кадре
  // досчитываются, и рамка по ширине текста дёргалась бы все полсекунды.
  ctx.font = `104px ${BOLD}`;
  const priceFinal = amount ? `${pricePrefix}${money(amount)} сом` : priceFallback;
  const priceWidth = Math.min(MAXW, ctx.measureText(priceFinal).width + 72);

  // Вертикаль полосы. Заголовок стоит сразу под жирной линейкой, дальше ценник,
  // тонкая линейка и текст. В сетке профиля (Instagram берёт из кадра 4:5 по
  // центру, срезая сверху и снизу по 285 точек) в кадр попадают заголовок и цена
  // — то есть ровно то, по чему объявление и выбирают.
  const titleY = BODY_TOP;
  const priceY = titleY + TITLE_LINE * title.length + 40;
  const dividerY = priceY + 190;
  const descriptionY = dividerY + 40;

  // Описание режем по тому месту, которое осталось до подвала, а не по
  // постоянным шести строкам: у длинного заголовка их столько уже не помещается.
  ctx.font = `48px ${REGULAR}`;
  const fits = Math.max(0, Math.floor((TEXT_BOTTOM - descriptionY) / LINE));
  const description =
    parsed.description && fits > 0 ? wrap(ctx, parsed.description, MAXW, Math.min(6, fits)) : [];

  return {
    accent,
    index, total,
    meta,
    title, titleY,
    amount, pricePrefix, priceFallback, priceWidth, priceY,
    dividerY,
    description, descriptionY,
  };
}

// Зерно поверх фона тут пробовали — плёночный шум обычно снимает «нарисованность»
// ровного градиента. Не прижилось: на 720p после h264 его не видно вовсе, а
// заливка кадра паттерном стоила 29 лишних секунд на ролик (41,6 против 12,7).
// Если возвращать — только вместе с ростом разрешения.

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
  // Бумага. Ровный кремовый, а не градиент во всю высоту: цвет в этом макете —
  // акцент (колонтитул, рубрика), и если залить им же фон, акценту негде
  // прозвучать. Подкраска остаётся, но еле слышная — она только снимает
  // ощущение белого листа из принтера.
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, DW, DH);
  glow(ctx, 980 + Math.cos(t * 0.4) * 60, 240 + Math.sin(t * 0.35) * 40, 620, l.accent, 0.1);
  glow(ctx, 80 + Math.sin(t * 0.3) * 50, 1620 + Math.cos(t * 0.32) * 40, 560, l.accent, 0.07);

  // Колонтитул: цветная полоса во всю ширину кадра. Она держит верх так же, как
  // в журнале — шмуцтитул: под ней начинается полоса с объявлением. Рисуем её
  // до наезда и не трогаем зумом — это рамка ролика, а не часть объявления,
  // поэтому она стоит неподвижно и переживает смену карточек без анимации.
  const hp = at(t, 0.05, 0.55);
  if (hp > 0) {
    const e = easeOut(hp);
    ctx.save();
    // Полоса раскрывается слева направо, а не проявляется: в ленте это первое
    // движение кадра, и оно должно читаться как «начали», а не как загрузка.
    ctx.fillStyle = l.accent;
    ctx.fillRect(0, SAFE_TOP, DW * e, HEAD_H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, SAFE_TOP, DW * e, HEAD_H);
    ctx.clip();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `40px ${BOLD}`;
    ctx.fillStyle = COLORS.white;
    tracked(ctx, l.collection.toUpperCase(), PAD, SAFE_TOP + HEAD_H / 2, 5);
    ctx.textAlign = 'right';
    ctx.font = `40px ${SEMI}`;
    ctx.fillStyle = rgba(COLORS.white, 0.85);
    ctx.fillText(l.day, DW - PAD, SAFE_TOP + HEAD_H / 2);
    ctx.restore();

    // Прогресс ролика — светлой линией по нижней кромке колонтитула. Отдельной
    // полоски больше нет: в этом макете она была бы третьей горизонталью подряд.
    ctx.globalAlpha = e;
    ctx.fillStyle = rgba(COLORS.white, 0.85);
    ctx.fillRect(0, HEAD_BOTTOM - 7, DW * Math.min(1, progress), 7);
    ctx.restore();
  }

  // Медленный наезд на полосу: движение есть, а читать не мешает. Колонтитул
  // остался снаружи и не едет — иначе цветная полоса лезла бы за край кадра.
  ctx.save();
  const zoom = 1 + 0.022 * easeInOut(Math.min(1, t / CARD_SECONDS));
  ctx.translate(DW / 2, DH / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-DW / 2, -DH / 2);

  // Номер объявления гигантом на полях — как номер страницы в журнале. Он
  // говорит, где мы в ролике, и заполняет низ полосы у коротких объявлений.
  // Рисуем до текста и совсем бледным: это фактура бумаги, а не сообщение.
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `420px ${BOLD}`;
  ctx.fillStyle = rgba(COLORS.text, 0.04);
  ctx.fillText(String(l.index + 1).padStart(2, '0'), DW - 40, TEXT_BOTTOM + 20);
  ctx.restore();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Рубрика: «ВАКАНСИЯ · ТРАНСПОРТ · БИШКЕК» цветным капсом в разрядку. Она
  // заменила цветную плашку — на полосе плашка спорила бы с колонтитулом.
  const bp = at(t, 0.15, 0.5);
  if (bp > 0) {
    const e = easeOut(bp);
    ctx.save();
    ctx.globalAlpha = e;
    ctx.font = `36px ${SEMI}`;
    ctx.fillStyle = l.accent;
    tracked(ctx, l.meta, PAD, META_TOP + (1 - e) * 20, 5);

    // «1 / 3» на другом краю той же строки. Без счётчика зритель не знает, что
    // за первым объявлением будет ещё два, и уходит с ролика на середине.
    if (l.total > 1) {
      ctx.textAlign = 'right';
      ctx.fillStyle = rgba(COLORS.text, 0.35);
      ctx.fillText(`${l.index + 1} / ${l.total}`, DW - PAD, META_TOP + (1 - e) * 20);
    }
    ctx.restore();
  }

  // Жирная линейка под рубрикой — тот самый журнальный приём, который держит
  // всю полосу. Прочерчивается слева направо вслед за колонтитулом.
  const rp = at(t, 0.3, 0.5);
  if (rp > 0) {
    ctx.fillStyle = COLORS.text;
    ctx.fillRect(PAD, RULE_Y, MAXW * easeOut(rp), 6);
  }

  // Заголовок — строка за строкой, а не разом: взгляд успевает зацепиться
  ctx.font = `104px ${BOLD}`;
  ctx.fillStyle = COLORS.text;
  l.title.forEach((line, i) =>
    rise(ctx, line, PAD, l.titleY + i * TITLE_LINE, at(t, 0.45 + i * 0.12, 0.5)));

  // Цена в контурной рамке и досчитывается до своей суммы — на этом кадре
  // взгляд и должен остановиться. Рамка вместо заливки: на бумажной полосе
  // ценник в рамке читается как ценник на витрине, а цветная плашка — как
  // кнопка из интерфейса.
  const pp = at(t, 1.15, 0.6);
  if (pp > 0) {
    const count = easeOut(at(t, 1.15, 0.9));
    const price = l.amount
      ? `${l.pricePrefix}${money(Math.round((l.amount * count) / 10) * 10)} сом`
      : l.priceFallback;
    ctx.save();
    ctx.globalAlpha = Math.min(1, pp * 2);
    // Масштабируем от левого края рамки, а не от её середины: иначе на выезде
    // текст уезжал бы за поля полосы.
    ctx.translate(PAD, l.priceY + 75);
    const s = 0.82 + easeBack(pp) * 0.18;
    ctx.scale(s, s);
    // «Цена договорная» — не сумма, и держать её тем же плотным контуром
    // нельзя: она кричала бы громче заголовка.
    ctx.strokeStyle = l.amount ? COLORS.text : rgba(COLORS.text, 0.3);
    ctx.lineWidth = 6;
    roundRect(ctx, 0, -75, l.priceWidth, 150, 0, true);
    ctx.font = `104px ${BOLD}`;
    ctx.fillStyle = l.amount ? COLORS.text : rgba(COLORS.text, 0.5);
    ctx.textBaseline = 'middle';
    ctx.fillText(price, 36, 2);
    ctx.restore();
  }

  // Тонкая линейка перед текстом — пара к жирной сверху
  const dp = at(t, 1.5, 0.5);
  if (dp > 0) {
    ctx.fillStyle = rgba(COLORS.text, 0.2);
    ctx.fillRect(PAD, l.dividerY, MAXW * easeOut(dp), 2);
  }

  ctx.font = `48px ${REGULAR}`;
  ctx.fillStyle = COLORS.body;
  l.description.forEach((line, i) =>
    rise(ctx, line, PAD, l.descriptionY + i * 66, at(t, 1.75 + i * 0.09, 0.45), 30)
  );

  // Подвал прибит к низу кадра, а не к концу текста: у объявлений разная длина,
  // и «плавающий» логотип в ленте выглядел бы как разные шаблоны. Тёмной плашки
  // больше нет — полосу закрывает та же жирная линейка, что открывает её сверху.
  const fp = at(t, 2.3, 0.6);
  if (fp > 0) {
    const e = easeOut(fp);
    ctx.save();
    ctx.globalAlpha = e;
    ctx.fillStyle = COLORS.text;
    ctx.fillRect(PAD, FOOTER_TOP + 40, MAXW * e, 4);

    const lp = at(t, 2.6, 0.6);
    if (lp > 0) {
      ctx.save();
      ctx.translate(PAD + 54, FOOTER_TOP + 144);
      ctx.scale(easeBack(lp), easeBack(lp));
      ctx.rotate((1 - easeOut(lp)) * -0.4);
      logo(ctx, -54, -54, 108, COLORS.red, COLORS.white);
      ctx.restore();
    }

    const textX = PAD + 108 + 32;
    ctx.font = `58px ${BOLD}`;
    ctx.fillStyle = COLORS.text;
    ctx.fillText('Шабашка', textX, FOOTER_TOP + 96);
    ctx.fillStyle = COLORS.red;
    ctx.fillText('.com', textX + ctx.measureText('Шабашка').width, FOOTER_TOP + 96);
    ctx.font = `34px ${REGULAR}`;
    ctx.fillStyle = rgba(COLORS.text, 0.5);
    ctx.fillText('заказы и вакансии Кыргызстана', textX, FOOTER_TOP + 166);
    ctx.restore();
  }

  ctx.restore();
}

// Концовка одинаковая для всех роликов: её задача не рассказать про заказ,
// а оставить в голове адрес сайта. t здесь — время от начала перехода.
function drawOutro(ctx, t, cta) {
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

  // Концовка набрана по тем же правилам, что и полоса с объявлением: левый край,
  // жирные линейки, капс в разрядку. Центрированная композиция досталась от
  // прежнего макета и после пересборки читалась как кадр из другого ролика.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const float = Math.sin(t * 1.8) * 10;

  const lp = at(t, 0.2, 0.7);
  if (lp > 0) {
    ctx.save();
    ctx.translate(PAD + 90, 620 + float);
    ctx.scale(easeBack(lp), easeBack(lp));
    ctx.rotate((1 - easeOut(lp)) * 0.5);
    ctx.globalAlpha = Math.min(1, lp * 2);
    logo(ctx, -90, -90, 180, COLORS.white, COLORS.red);
    ctx.restore();
  }

  // Линейка над названием — та же, что открывает полосу с объявлением
  const up = at(t, 0.45, 0.6);
  if (up > 0) {
    ctx.fillStyle = COLORS.white;
    ctx.fillRect(PAD, 830, MAXW * easeOut(up), 8);
  }

  ctx.fillStyle = COLORS.white;
  // 124-м «Шабашка.com» встаёт ровно в поля полосы; на 132-м хвост «.com»
  // подходил к правому краю ближе, чем отступ слева, и строка выглядела съехавшей.
  ctx.font = `124px ${BOLD}`;
  rise(ctx, 'Шабашка', PAD, 950 + float * 0.4, at(t, 0.5, 0.6));
  const nameWidth = ctx.measureText('Шабашка').width;
  ctx.fillStyle = rgba(COLORS.white, 0.6);
  rise(ctx, '.com', PAD + nameWidth, 950 + float * 0.4, at(t, 0.6, 0.6));

  ctx.font = `70px ${REGULAR}`;
  ctx.fillStyle = rgba(COLORS.white, 0.9);
  rise(ctx, 'найди работу', PAD, 1070, at(t, 0.7, 0.6));

  // Строка снизу тихо пульсирует — единственный призыв к действию в ролике,
  // и он должен доживать до конца кадра, а не потеряться в красном поле.
  const cp = at(t, 1.1, 0.6);
  if (cp > 0) {
    ctx.fillStyle = rgba(COLORS.white, 0.35);
    ctx.fillRect(PAD, 1180, MAXW * easeOut(cp), 2);
    ctx.globalAlpha = easeOut(cp) * (0.78 + Math.sin(t * 3) * 0.18);
    ctx.fillStyle = COLORS.white;
    // Капс с разрядкой держит строку только пока она короткая. У дайджеста это
    // «и ещё 37 вакансий на сайте», а у обычного выпуска — «заказы и вакансии по
    // всему Кыргызстану», и она в капсе за поля не влезает: тогда набираем её
    // обычным строчным, без разрядки.
    ctx.font = `44px ${SEMI}`;
    if (trackedWidth(ctx, cta.toUpperCase(), 4) <= MAXW) {
      tracked(ctx, cta.toUpperCase(), PAD, 1250, 4);
    } else {
      ctx.font = `44px ${REGULAR}`;
      ctx.fillText(cta, PAD, 1250);
    }
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
// opts — как назвать выпуск: { collection, day, cta }. Пустые поля берутся по
// умолчанию («Заказы дня», сегодняшнее число), и обычному ролику передавать
// ничего не нужно. Дайджест с сайта («Топ-5 вакансий · за 2 дня») подменяет все три.
function createRenderer(items, opts = {}) {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  // Заголовок выпуска берём по первому объявлению: пачка собирается из одного
  // типа (см. очереди в social/index.js), так что он общий на весь ролик.
  const collection = opts.collection || collectionTitle(items[0] && items[0].listingType);
  const day = opts.day || dayLabel();
  const cta = opts.cta || DEFAULT_CTA;
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
        wipeIn(ctx, at(t, outroAt, WIPE_SECONDS), () => drawOutro(ctx, t - outroAt, cta));
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

// Фото своих продуктов (см. telegram/products.js) перед Threads и Instagram.
//
// Telegram отдаёт что прислали: сжатое фото — JPEG, «файлом» — PNG или WebP в
// исходном размере. Instagram берёт только JPEG и только с пропорциями от 4:5
// до 1.91:1: скриншот приложения (9:19) или пригласительная во весь экран
// телефона он отклоняет целиком, вместе с каруселью. Поэтому для Instagram фото
// вписываем в допустимую рамку, а поля заливаем его же средним цветом — так
// рамка не бросается в глаза. Threads вытянутые фото принимает, им хватает
// JPEG и разумного размера.
const { createCanvas, loadImage } = require('@napi-rs/canvas');

// Шире Meta всё равно не показывает и сама ужимает до этого.
const MAX_WIDTH = 1440;
const INSTAGRAM_WIDTH = 1080;
const INSTAGRAM_MIN_RATIO = 4 / 5;
const INSTAGRAM_MAX_RATIO = 1.91;
const QUALITY = 90;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function averageColor(img) {
  const canvas = createCanvas(1, 1);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

function forThreads(img) {
  const scale = Math.min(1, MAX_WIDTH / img.width);
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvas.encode('jpeg', QUALITY);
}

// ratio — ширина к высоте у всей карусели: Instagram показывает её в
// пропорциях первого фото, и разные рамки у соседних выглядели бы рывками.
function forInstagram(img, ratio) {
  const width = INSTAGRAM_WIDTH;
  const height = Math.round(width / ratio);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = averageColor(img);
  ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / img.width, height / img.height);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  ctx.drawImage(img, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
  return canvas.encode('jpeg', QUALITY);
}

// buffers — фото по порядку. Возвращает JPEG для каждой площадки, в том же
// порядке.
async function prepare(buffers) {
  if (!buffers.length) return { threads: [], instagram: [] };
  const images = await Promise.all(buffers.map((b) => loadImage(b)));
  const ratio = clamp(images[0].width / images[0].height, INSTAGRAM_MIN_RATIO, INSTAGRAM_MAX_RATIO);
  return {
    threads: await Promise.all(images.map(forThreads)),
    instagram: await Promise.all(images.map((img) => forInstagram(img, ratio))),
  };
}

module.exports = { prepare };

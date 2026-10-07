// Подготовка фото своих продуктов (см. src/social/photos.js) — на настоящих
// картинках. Instagram отклоняет всё, что уже 4:5 и шире 1.91:1, а скриншот
// приложения или пригласительная во весь экран телефона — как раз 9:19.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const photos = require('../src/social/photos');

async function picture(width, height, format = 'png') {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#d4a5a5';
  ctx.fillRect(0, 0, width, height);
  return canvas.encode(format);
}

const size = async (buffer) => {
  const img = await loadImage(buffer);
  return [img.width, img.height];
};
const isJpeg = (buffer) => buffer.subarray(0, 3).toString('hex') === 'ffd8ff';

test('вытянутое фото: Threads — как есть, Instagram — в рамке 4:5', async () => {
  const { threads, instagram } = await photos.prepare([await picture(1080, 2340)]);
  assert.ok(isJpeg(threads[0]) && isJpeg(instagram[0]), 'PNG перегнали в JPEG — другого Instagram не берёт');
  assert.deepEqual(await size(threads[0]), [1080, 2340]);
  assert.deepEqual(await size(instagram[0]), [1080, 1350]);
});

test('широкое и большое: ужимаем до 1440, Instagram — не шире 1.91:1', async () => {
  const { threads, instagram } = await photos.prepare([await picture(3000, 1000, 'webp')]);
  assert.deepEqual(await size(threads[0]), [1440, 480]);
  assert.deepEqual(await size(instagram[0]), [1080, 565]);
});

test('карусель — в пропорциях первого фото, чтобы соседние не прыгали', async () => {
  const { instagram } = await photos.prepare([await picture(1000, 1000), await picture(1080, 2340)]);
  assert.deepEqual(await size(instagram[0]), [1080, 1080]);
  assert.deepEqual(await size(instagram[1]), [1080, 1080]);
});

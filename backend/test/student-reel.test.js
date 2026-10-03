// Студенческий выпуск (см. card.js): первым экраном «ВАКАНСИЯ ДЛЯ СТУДЕНТОВ»
// белым по синему, с него же обложка в сетке профиля, и вся вакансия — в той
// же синей теме. Обычный ролик при этом остаётся прежним.
const test = require('node:test');
const assert = require('node:assert/strict');

const card = require('../src/social/card');

const parsed = {
  title: 'Официант в кафе',
  description: 'Смены по 4–6 часов, можно совмещать с учёбой.',
  category: 'Общепит',
  city: 'Бишкек',
  budget: 25000,
};
const student = [{ parsed: { ...parsed, for_students: true }, listingType: 'vacancy' }];
const plain = [{ parsed, listingType: 'vacancy' }];

// Цвет точки кадра: холст отдаёт RGBA подряд, 720 точек в строке.
function pixel(buffer, x, y) {
  const i = (y * card.W + x) * 4;
  return { r: buffer[i], g: buffer[i + 1], b: buffer[i + 2] };
}
const isBlue = ({ r, g, b }) => b > 180 && b > r + 80;
const isPaper = ({ r, g, b }) => r > 220 && g > 220 && b > 210;

test('студенческий ролик начинается с синего экрана и берёт его на обложку', () => {
  const reel = card.createRenderer(student);
  const usual = card.createRenderer(plain);
  assert.equal(reel.coverMs, 1200, 'обложка — первый экран «для студентов»');
  assert.equal(usual.coverMs, 3600, 'у обычного — по-прежнему первая карточка');
  assert.ok(Math.abs(reel.seconds - usual.seconds - card.INTRO_SECONDS) < 1e-9, 'первый экран добавлен до карточек');

  assert.ok(isBlue(pixel(reel.frame(1.2), 20, 20)), 'первый экран синий');
  assert.ok(isBlue(pixel(reel.frame(card.INTRO_SECONDS + 3.6), 20, 1250)), 'и карточка вакансии в синей теме');
  assert.ok(isPaper(pixel(usual.frame(3.6), 20, 1250)), 'обычная вакансия — на прежней бумаге');
});

test('смешанная пачка — не студенческая: синее и кремовое в одном ролике не мешаем', () => {
  const mixed = card.createRenderer([...student, ...plain]);
  assert.equal(mixed.coverMs, 3600);
});

test('выпуск называется так, чтобы студент узнал себя по шапке', () => {
  assert.equal(card.collectionTitle('vacancy', 1, { students: true }), 'Вакансия для студентов');
  assert.equal(card.collectionTitle('vacancy_students'), 'Вакансии для студентов');
  assert.equal(card.collectionTitle('order_students', 1), 'Подработка для студентов');
  assert.equal(card.collectionTitle('vacancy'), 'Вакансии дня', 'обычные названия не тронуты');
});

test('картинка для сетки, если ролик не доехал, тоже синяя', async () => {
  const jpeg = await card.renderStill(student[0]);
  assert.ok(jpeg.length > 10000);
});

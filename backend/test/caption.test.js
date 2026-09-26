// Подписи к постам (см. src/social/video.js).
//
// Два разных ограничения. В Instagram подпись длинная, но ссылки в ней не
// кликабельны — поэтому там телефон и зов в шапку профиля. В Threads пост не
// длиннее 500 знаков, причём эмодзи считаются байтами UTF-8, то есть за четыре;
// зато ссылка работает, и адрес объявления идёт прямо в тексте.
//
// И отдельно — разнообразие. Одинаковый хвост под сотней постов подряд вместе с
// одинаковым макетом и есть то, по чему площадка отличает рассылку от живого
// аккаунта, а вместе с ним уходят и просмотры.
const test = require('node:test');
const assert = require('node:assert/strict');

const video = require('../src/social/video');

const parsed = {
  title: 'Нужен сантехник',
  description: 'Поменять смеситель в квартире, инструмент свой',
  category: 'Сантехника',
  city: 'Бишкек',
  budget: 2000,
  phone: '+996700111222',
};
const item = { parsed, listingType: 'order', siteLink: 'шабашка.com/orders/12' };

test('в подписи есть всё, по чему на объявление откликаются', () => {
  const text = video.caption([item], null, {});
  assert.match(text, /Нужен сантехник/);
  assert.match(text, /Сантехника · Бишкек/);
  assert.match(text, /2 000 сом/, 'цена с разрядами, а не «2000»');
  assert.match(text, /\+996700111222/, 'телефон обязателен: ссылки в Instagram не кликаются');
  assert.match(text, /шабашка\.com\/orders\/12/);
  assert.match(text, /#шабашка/);
});

test('хвост из тегов не повторяется слово в слово от поста к посту', () => {
  const tails = new Set();
  for (let i = 0; i < 30; i += 1) tails.add(video.caption([item], null, {}).split('\n').pop());
  assert.ok(tails.size > 1, 'набор тегов собирается заново каждый раз');
  for (const tail of tails) {
    assert.match(tail, /#шабашка/, 'постоянные теги на месте');
    assert.match(tail, /#подработкабишкек/);
    const tags = tail.split(' ');
    assert.equal(new Set(tags).size, tags.length, 'теги не повторяются внутри поста');
    assert.ok(tags.length <= 6, `тегов не больше шести, а вышло ${tags.length}`);
  }
});

test('концовка тоже вразнобой, но всегда зовёт в шапку профиля', () => {
  const lines = new Set();
  for (let i = 0; i < 30; i += 1) {
    const rows = video.caption([item], null, {}).split('\n');
    lines.add(rows[rows.length - 3]);
  }
  assert.ok(lines.size > 1);
  for (const line of lines) assert.match(line, /Шабашка\.com/);
});

test('у объявления с доски свои теги — по «подработке» туда приходили не те', () => {
  const tail = video
    .caption([{ ...item, listingType: 'board', parsed: { ...parsed, title: 'Продаю дом' } }], null, {})
    .split('\n')
    .pop();
  assert.match(tail, /#объявлениябишкек/);
  assert.ok(!/#подработкабишкек/.test(tail), tail);
});

test('автор трека называется обязательно — это условие лицензии', () => {
  const credit = '♪ Hyperfun — Kevin MacLeod (incompetech.com), фрагмент';
  assert.match(video.caption([item], credit, {}), /Kevin MacLeod/);
});

test('описание ужимается, когда объявлений в ролике много', () => {
  const long = { ...item, parsed: { ...parsed, description: 'очень подробно. '.repeat(80) } };
  const five = video.caption([long, long, long, long, long], null, {});
  assert.ok(five.length < 2200, `в подпись Instagram влезает 2200 знаков, а вышло ${five.length}`);
});

test('пост в Threads укладывается в 500 знаков, считая эмодзи за четыре', () => {
  const long = { ...parsed, description: 'Очень подробное описание работы. '.repeat(30) };
  const text = video.threadsText(long, 'order', 'шабашка.com/orders/12');
  let weight = 0;
  for (const ch of text) weight += ch.codePointAt(0) > 0xffff ? Buffer.byteLength(ch) : 1;
  assert.ok(weight <= 500, `вес поста ${weight}`);
  assert.match(text, /шабашка\.com\/orders\/12/, 'ссылка в Threads кликается — она обязана остаться');
  assert.match(text, /\+996700111222/, 'и телефон тоже');
  assert.match(text, /…/, 'обрезанное описание кончается многоточием, а не обрубком');
});

test('короткое объявление в Threads не режется', () => {
  const text = video.threadsText({ ...parsed, description: 'Коротко и ясно' }, 'vacancy', 'шабашка.com/vacancies/3');
  assert.match(text, /Коротко и ясно/);
  assert.ok(!/…/.test(text));
});

test('по умолчанию реклама выходит без пометки — так решил владелец', () => {
  assert.equal(video.adLine(), '');
  const text = video.threadsText(parsed, 'vacancy', 'шабашка.com/vacancies/3', { ad: true });
  assert.ok(!text.includes('Реклама'), text);
});

test('пометку рекламы и тег можно выключить словом off — Render не всегда даёт пустое значение', () => {
  const saved = { ...process.env };
  const { optional } = video;
  for (const value of ['off', 'OFF', 'none', 'нет', '-', '']) {
    process.env.AD_LABEL = value;
    assert.equal(optional('AD_LABEL', 'Реклама'), '', `«${value}» выключает`);
  }
  process.env.AD_LABEL = 'Жарнама';
  assert.equal(optional('AD_LABEL', 'Реклама'), 'Жарнама', 'своё слово берётся как есть');
  delete process.env.AD_LABEL;
  assert.equal(optional('AD_LABEL', 'Реклама'), 'Реклама', 'не задано — по умолчанию');
  process.env = saved;
});

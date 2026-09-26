// «Поднять» объявление можно раз в сутки (см. src/bump.js). Без промежутка
// кнопка превращается в способ занять верх ленты навсегда.
const test = require('node:test');
const assert = require('node:assert/strict');

const bump = require('../src/bump');

const HOUR = 3600 * 1000;
const now = Date.parse('2026-09-24T12:00:00Z');
const ago = (hours) => new Date(now - hours * HOUR);

test('сутки ещё не прошли — поднимать нельзя, и в ответе сказано когда можно', () => {
  const early = bump.tooSoon({ bumped_at: ago(1) }, now);
  assert.ok(early, 'через час после поднятия кнопка не работает');
  assert.match(early.error, /раз в сутки/);
  assert.match(early.error, /Следующий раз/);
  assert.equal(new Date(early.nextBumpAt).getTime(), now + 23 * HOUR);
});

test('сутки прошли — поднимать можно', () => {
  assert.equal(bump.tooSoon({ bumped_at: ago(24) }, now), null);
  assert.equal(bump.tooSoon({ bumped_at: ago(48) }, now), null);
});

test('ни разу не поднимали — считаем от публикации: свежее и так наверху', () => {
  assert.ok(bump.tooSoon({ created_at: ago(2) }, now), 'двухчасовое объявление поднимать нечего');
  assert.equal(bump.tooSoon({ created_at: ago(30) }, now), null);
});

test('последнее поднятие важнее даты публикации', () => {
  // Старое объявление, поднятое только что, ждёт, как и всякое другое.
  assert.ok(bump.tooSoon({ created_at: ago(200), bumped_at: ago(1) }, now));
});

test('строка без обеих дат не должна ронять роут', () => {
  assert.equal(bump.tooSoon({}, now), null);
});

test('срок называется по Бишкеку, а не по UTC сервера', () => {
  // Поднято в 12:00 UTC — значит, снова можно в 12:00 UTC следующего дня,
  // а это 18:00 по Бишкеку. Именно это время автор и должен увидеть.
  const early = bump.tooSoon({ bumped_at: new Date(now) }, now);
  assert.match(early.error, /18:00/, early.error);
});

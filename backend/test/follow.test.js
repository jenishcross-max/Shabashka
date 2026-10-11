// Строка «подпишись» в постах (см. src/social/follow.js): у каждого четвёртого
// поста Threads, с круглым числом объявлений за сутки и разными словами, чтобы
// не примелькалась.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.FOLLOW_EVERY;
const follow = require('../src/social/follow');

test('строка — у каждого четвёртого поста, а варианты чередуются', () => {
  const got = Array.from({ length: 8 }, () => follow.next());
  assert.deepEqual(got.map(Boolean), [false, false, false, true, false, false, false, true]);
  assert.notEqual(got[3], got[7]);
});

test('число за сутки — круглое и с плюсом, маленькое не называем', () => {
  follow.setDaily(67);
  assert.match(follow.line(), /60\+/);
  follow.setDaily(12);
  assert.doesNotMatch(follow.line(), /\d/);
  follow.setDaily(null);
  assert.match(follow.line(), /^🔔 Подпишись/);
});

test('FOLLOW_EVERY: off и 0 выключают, мусор — по умолчанию', () => {
  assert.equal(follow.parseEvery('off'), 0);
  assert.equal(follow.parseEvery('0'), 0);
  assert.equal(follow.parseEvery('10'), 10);
  assert.equal(follow.parseEvery('abc'), 4);
  assert.equal(follow.parseEvery(undefined), 4);
});

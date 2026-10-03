// Проверка чека об оплате рекламы (см. verify в src/dm/receipt.js).
//
// Модель только переписывает, что видит на скриншоте; годится ли чек, решает
// код. Здесь — все способы, которыми чек может не годиться: не та сумма, не тот
// получатель, старый, уже присланный, не прошедший. И то, что скрытый
// звёздочками номер всё равно узнаётся по хвосту.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');

process.env.AD_PRICE = '50';
process.env.MBANK_NUMBER = '0700 123 456';
process.env.MBANK_NAME = 'Жениш Ш.';

// Модель здесь не нужна: проверяются правила, а не её ответы.
const requireSrc = install({ [at('telegram/extract.js')]: { complete: async () => ({}) } });
const receipt = requireSrc('dm/receipt.js');

const NOW = Date.UTC(2026, 8, 27, 10, 0);
const check = (extra = {}) => ({
  kind: 'receipt',
  success: true,
  amount: 50,
  currency: 'KGS',
  recipient: 'Жениш Ш.',
  account: '+996 700 *** 456',
  datetime: '2026-09-27 14:02',
  operationId: '123456789',
  bank: 'МБанк',
  ...extra,
});
const verify = (c, opts = {}) => receipt.verify(c, { now: NOW, ...opts });

test('правильный чек принимается', () => {
  const v = verify(check());
  assert.equal(v.ok, true);
  assert.deepEqual(v.warnings, []);
});

test('сумма меньше цены — не принят', () => {
  assert.equal(verify(check({ amount: 30 })).reason, 'amount');
  assert.equal(verify(check({ amount: 100 })).ok, true, 'переплата — не повод отказывать');
});

test('получатель узнаётся по имени или по хвосту номера', () => {
  assert.equal(verify(check({ recipient: '', account: '0700123456' })).ok, true);
  assert.equal(verify(check({ recipient: 'ЖЕНИШ ШАРШЕНОВ', account: '' })).ok, true);
  assert.equal(verify(check({ recipient: 'Айбек К.', account: '+996 555 *** 999' })).reason, 'recipient');
});

test('получателя не видно — принимаем, но админу говорим', () => {
  const v = verify(check({ recipient: '', account: '' }));
  assert.equal(v.ok, true);
  assert.ok(v.warnings.some((w) => /получател/.test(w)));
});

test('старый чек и чек без даты', () => {
  assert.equal(verify(check({ datetime: '2026-09-01 10:00' })).reason, 'old');
  assert.equal(verify(check({ datetime: '26.09.2026 22:15' })).ok, true, 'вчерашний вечерний — свежий');
  const noDate = verify(check({ datetime: '' }));
  assert.equal(noDate.ok, true);
  assert.ok(noDate.warnings.some((w) => /дат/.test(w)));
});

test('уже присланный, не прошедший и не чек вовсе', () => {
  assert.equal(verify(check(), { duplicate: true }).reason, 'duplicate');
  assert.equal(verify(check({ success: false })).reason, 'not_success');
  assert.equal(verify(check({ kind: 'photo' })).reason, 'not_receipt');
});

test('ключи повтора: картинка и номер операции', () => {
  const keys = receipt.keysOf(Buffer.from('скрин'), check());
  assert.equal(keys.length, 2);
  assert.ok(keys[0].startsWith('img:'));
  assert.equal(keys[1], 'op:123456789');
  assert.equal(receipt.keysOf(Buffer.from('скрин'), check({ operationId: '' })).length, 1);
});

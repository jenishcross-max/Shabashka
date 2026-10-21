// Метка источника в ссылке на сайт (см. src/sourceTag.js): по ней Метрика
// узнаёт, из какой площадки пришёл человек.
const test = require('node:test');
const assert = require('node:assert/strict');

const { tag } = require('../src/sourceTag');

test('метка — короткий параметр s в конце адреса', () => {
  assert.equal(tag('шабашка.com/vacancies/12', 'threads'), 'шабашка.com/vacancies/12?s=t');
  assert.equal(tag('https://xn--80aaac0cyed.com/vacancies', 'telegram'), 'https://xn--80aaac0cyed.com/vacancies?s=tg');
  assert.equal(tag('шабашка.com/rabota/obshchepit', 'bot'), 'шабашка.com/rabota/obshchepit?s=b');
});

test('свои параметры и якорь адреса метка не ломает', () => {
  assert.equal(tag('шабашка.com/vacancies?category=Общепит', 'threads'), 'шабашка.com/vacancies?category=Общепит&s=t');
  assert.equal(tag('шабашка.com/board#p12', 'telegram'), 'шабашка.com/board?s=tg#p12');
});

test('без ссылки или с незнакомой площадкой — адрес как был', () => {
  assert.equal(tag('', 'threads'), '');
  assert.equal(tag(null, 'threads'), '');
  assert.equal(tag('шабашка.com/vacancies/12', 'facebook'), 'шабашка.com/vacancies/12');
});

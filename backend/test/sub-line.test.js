// Строка подписки в бота в постах Threads (см. src/social/subLine.js): у части
// постов-вакансий вместо «Все N за сутки» — ссылка на подписку по профессии.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.SUB_EVERY;
const sub = require('../src/social/subLine');

test('у каждого второго поста-вакансии с профессией — подписка на эту профессию', () => {
  const got = Array.from({ length: 4 }, () => sub.line('vacancy', { category: 'Общепит' }, 'шабашка.com/vacancies/7'));
  assert.deepEqual(got.map(Boolean), [false, true, false, true]);
  assert.equal(got[1], '📲 Новые вакансии «Общепит» — в Telegram: шабашка.com/s/obshchepit');
});

test('без профессии, у заказа и без ссылки — строки нет, и очередь не сдвигается', () => {
  assert.equal(sub.line('vacancy', { category: 'Другое' }, 'шабашка.com/vacancies/1'), '');
  // Бот присылает только вакансии: звать в него из поста-заказа — обещать не то.
  assert.equal(sub.line('order', { category: 'Стройка и разнорабочие' }, 'шабашка.com/orders/1'), '');
  assert.equal(sub.line('vacancy', { category: 'Общепит' }, ''), '');
  assert.equal(sub.line('vacancy', null, 'шабашка.com/vacancies/1'), '');
  assert.equal(sub.line('vacancy', { category: 'Продажи' }, 'шабашка.com/vacancies/2'), '');
  assert.equal(
    sub.line('vacancy', { category: 'Продажи' }, 'шабашка.com/vacancies/3'),
    '📲 Новые вакансии «Продажи» — в Telegram: шабашка.com/s/prodazhi'
  );
});

test('адрес сайта берётся из ссылки поста, даже со схемой', () => {
  sub.line('vacancy', { category: 'Охрана' }, 'https://шабашка.com/vacancies/4');
  assert.equal(
    sub.line('vacancy', { category: 'Охрана' }, 'https://шабашка.com/vacancies/5'),
    '📲 Новые вакансии «Охрана» — в Telegram: шабашка.com/s/ohrana'
  );
});

test('SUB_EVERY: по умолчанию каждый второй, off выключает', () => {
  assert.equal(sub.EVERY, 2);
  assert.equal(sub.parseEvery(undefined), 2);
  assert.equal(sub.parseEvery('off'), 0);
  assert.equal(sub.parseEvery('3'), 3);
  assert.equal(sub.parseEvery('мусор'), 2);
});

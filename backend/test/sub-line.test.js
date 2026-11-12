// Строка подписки в бота в постах Threads (см. src/social/subLine.js): у части
// постов-вакансий вместо «Все N за сутки» — ссылка на подписку по профессии.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.SUB_EVERY;
// Тесты ниже — про строку бота; тест «группа против бота» — в конце файла, со своим экземпляром.
process.env.SUB_GROUP = 'off';
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

// Аудит 12 ноября 2026 (docs/research/2026-11-audit.md): Telegram-группа с кнопкой
// под каждым постом выросла за неделю на 18%, а бот за месяц набрал два десятка
// подписчиков. Что лучше зовёт из Threads — проверяем: половина строк подписки
// ведёт в бота, половина — в группу, и переходы считаются отдельно (/g → сводка).
test('группа против бота: строки подписки по очереди, в группу — через счётчик /g', () => {
  const line = sub.create({ every: 2, group: 'on' });
  const got = Array.from({ length: 4 }, () => line('vacancy', { category: 'Склад и грузчики' }, 'шабашка.com/vacancies/9'));
  assert.deepEqual(got, [
    '',
    '📲 Новые вакансии «Склад и грузчики» — в Telegram: шабашка.com/s/gruzchik',
    '',
    '✈️ Вакансии «Склад и грузчики» и вся работа — каждый день в Telegram-группе: шабашка.com/g',
  ]);
  assert.equal(sub.parseGroup(undefined), true, 'по умолчанию тест включён');
  assert.equal(sub.parseGroup('off'), false);
});

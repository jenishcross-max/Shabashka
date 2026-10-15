// Правила биржи без базы (см. src/exchange.js): что можно заказчику и
// исполнителю в каком статусе задачи и что каждый из них видит.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install } = require('./helpers/stub');

const exchange = install()('exchange.js');

const CATEGORIES = ['Уборка', 'Ремонт'];
const TASK = {
  title: '  Убраться в квартире ',
  description: 'Две комнаты',
  category: 'Уборка',
  city: 'Бишкек',
  work_format: 'offline',
  budget: '3 000',
};

test('задача: поля чистятся, бюджет понимает пробелы, пустой — null', () => {
  const { errors, result } = exchange.validateTask(TASK, { categories: CATEGORIES });
  assert.deepEqual(errors, []);
  assert.equal(result.title, 'Убраться в квартире');
  assert.equal(result.budget, 3000);
  assert.equal(result.address, null);
  assert.equal(result.when_text, null);

  const free = exchange.validateTask({ ...TASK, budget: '' }, { categories: CATEGORIES });
  assert.equal(free.result.budget, null);
});

test('задача: без названия, с чужой категорией и дробным бюджетом — ошибки', () => {
  const { errors } = exchange.validateTask(
    { ...TASK, title: ' ', category: 'Космос', budget: '10.5' },
    { categories: CATEGORIES }
  );
  assert.equal(errors.length, 3);
  assert.match(errors[0], /что нужно сделать/);
});

test('задача: работа за границей не публикуется — как у заказов', () => {
  const { errors } = exchange.validateTask(
    { ...TASK, description: 'Работа в Москве, билет оплатим' },
    { categories: CATEGORIES }
  );
  assert.match(errors.join(), /только работу в Кыргызстане/);
});

test('задача: частичная правка проверяет только присланное', () => {
  const { errors, result } = exchange.validateTask({ budget: null }, { categories: CATEGORIES, partial: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(result, { budget: null });
});

test('отклик: цена обязательна и целая, срок и комментарий — тоже', () => {
  const ok = exchange.validateOffer({ price: '2 500', term: 'за день', comment: 'Свой пылесос' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.result.price, 2500);

  const bad = exchange.validateOffer({ price: 0, term: '', comment: '' });
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors[0], /цену/);
  assert.equal(exchange.validateOffer({ price: 20000000, term: 'x', comment: 'y' }).errors.length, 1);
});

test('откликнуться: не на свою, не на закрытую, снятый и отменённый не воскресают', () => {
  const task = { user_id: 1, status: 'open' };
  assert.equal(exchange.offerBlocker(task, 2, null), null);
  assert.equal(exchange.offerBlocker(task, 2, { status: 'withdrawn' }), null);
  assert.equal(exchange.offerBlocker(task, 1, null).status, 400);
  assert.match(exchange.offerBlocker({ ...task, status: 'assigned' }, 2, null).error, /уже выбран/);
  assert.equal(exchange.offerBlocker(task, 2, { status: 'removed' }).status, 403);
  assert.equal(exchange.offerBlocker(task, 2, { status: 'dropped' }).status, 403);
});

test('действия заказчика: только своё и только из нужного статуса', () => {
  const open = { user_id: 1, status: 'open' };
  assert.equal(exchange.ownerBlocker(open, 2, 'cancel').status, 403);
  assert.equal(exchange.ownerBlocker(open, 1, 'accept'), null);
  assert.equal(exchange.ownerBlocker(open, 1, 'edit'), null);
  assert.match(exchange.ownerBlocker(open, 1, 'done').error, /выберите исполнителя/);
  assert.match(exchange.ownerBlocker(open, 1, 'unassign').error, /ещё не выбран/);

  const assigned = { user_id: 1, status: 'assigned' };
  assert.match(exchange.ownerBlocker(assigned, 1, 'accept').error, /уже выбран/);
  assert.match(exchange.ownerBlocker(assigned, 1, 'edit').error, /пока исполнитель не выбран/);
  assert.equal(exchange.ownerBlocker(assigned, 1, 'done'), null);
  assert.equal(exchange.ownerBlocker(assigned, 1, 'cancel'), null);

  assert.match(exchange.ownerBlocker({ user_id: 1, status: 'done' }, 1, 'cancel').error, /выполнена/);
});

test('отозвать можно только активный отклик открытой задачи', () => {
  const open = { user_id: 1, status: 'open' };
  assert.equal(exchange.withdrawBlocker(open, { status: 'active' }), null);
  assert.equal(exchange.withdrawBlocker(open, null).status, 404);
  assert.equal(exchange.withdrawBlocker({ ...open, status: 'assigned' }, { status: 'active' }).status, 409);
});

test('что исполнитель видит про свой отклик', () => {
  assert.equal(exchange.offerState('active', 'open'), 'waiting');
  assert.equal(exchange.offerState('active', 'assigned'), 'other');
  assert.equal(exchange.offerState('active', 'done'), 'other');
  assert.equal(exchange.offerState('accepted', 'assigned'), 'chosen');
  assert.equal(exchange.offerState('accepted', 'done'), 'done');
  assert.equal(exchange.offerState('accepted', 'cancelled'), 'cancelled');
  assert.equal(exchange.offerState('active', 'cancelled'), 'cancelled');
  assert.equal(exchange.offerState('withdrawn', 'assigned'), 'withdrawn');
  assert.equal(exchange.offerState('dropped', 'open'), 'dropped');
  assert.equal(exchange.offerState('removed', 'open'), 'removed');
});

test('первое сообщение выбранному: задача, цена с разрядами и срок', () => {
  const text = exchange.chosenMessage({ title: 'Убраться' }, { price: 12500, term: 'за день' });
  assert.match(text, /«Убраться»/);
  assert.match(text, /12 500 сом/);
  assert.match(text, /за день/);
});

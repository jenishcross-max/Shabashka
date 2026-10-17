// Правила раздела «Объявления» без базы (src/adsRules.js): что примет форма и
// кому какие действия с объявлением разрешены.
const test = require('node:test');
const assert = require('node:assert/strict');

const rules = require('../src/adsRules');

const OK = {
  kind: 'rent_out',
  category: 'rest',
  title: 'Номер в пансионате',
  description: 'На двоих, завтрак включён',
  price: '2 500',
  price_unit: 'day',
  city: 'Чолпон-Ата',
  address: '',
  whatsapp_phone: '0700 123 456',
  photos: [],
};
const photo = (userId, n = 0) => `u${userId}/123e4567-e89b-42d3-a456-42661417400${n}.jpg`;

test('нормальное объявление проходит, цена и телефон приводятся', () => {
  const { errors, result } = rules.validateAd(OK, { userId: 7 });
  assert.deepEqual(errors, []);
  assert.equal(result.price, 2500);
  assert.equal(result.price_unit, 'day');
  assert.equal(result.whatsapp_phone, '+996700123456');
  assert.equal(result.address, null);
  assert.deepEqual(result.photos, []);
});

test('без цены — договорная: ни суммы, ни «за что»', () => {
  const { errors, result } = rules.validateAd({ ...OK, price: '' }, { userId: 7 });
  assert.deepEqual(errors, []);
  assert.equal(result.price, null);
  assert.equal(result.price_unit, null);
});

test('«Отдам даром» — цену не принимаем, даже если прислали', () => {
  const { errors, result } = rules.validateAd({ ...OK, kind: 'free', price: 500 }, { userId: 7 });
  assert.deepEqual(errors, []);
  assert.equal(result.price, null);
  assert.equal(result.price_unit, null);
});

test('цена есть, а «за что» не указано — за всё', () => {
  const { result } = rules.validateAd({ ...OK, kind: 'sell', price: 45000, price_unit: undefined }, { userId: 7 });
  assert.equal(result.price_unit, 'total');
});

test('ошибки в полях называются по-человечески', () => {
  const bad = (patch) => rules.validateAd({ ...OK, ...patch }, { userId: 7 }).errors;
  assert.equal(bad({ kind: 'swap' }).length, 1);
  assert.equal(bad({ category: 'cars' }).length, 1);
  assert.equal(bad({ price_unit: 'week' }).length, 1);
  assert.equal(bad({ price: 'дорого' }).length, 1);
  assert.equal(bad({ price: -5 }).length, 1);
  assert.equal(bad({ title: '  ' }).length, 1);
  assert.equal(bad({ description: '' }).length, 1);
  assert.equal(bad({ city: '' }).length, 1);
  assert.equal(bad({ title: 'х'.repeat(rules.LIMITS.title + 1) }).length, 1);
  assert.equal(bad({ whatsapp_phone: '12345' }).length, 1);
  assert.deepEqual(bad({ whatsapp_phone: '' }), []);
});

test('фото: только свои пути, не больше шести, без повторов', () => {
  const check = (photos) => rules.validateAd({ ...OK, photos }, { userId: 7 });
  assert.deepEqual(check([photo(7, 1), photo(7, 2)]).result.photos, [photo(7, 1), photo(7, 2)]);
  assert.equal(check([photo(8)]).errors.length, 1, 'чужая папка');
  assert.equal(check(['u7/../u8/x.jpg']).errors.length, 1, 'обход папки');
  assert.equal(check([photo(7, 1), photo(7, 1)]).errors.length, 1, 'повтор');
  const seven = Array.from({ length: 7 }, (_, i) => photo(7, i));
  assert.equal(check(seven).errors.length, 1, 'больше шести');
  assert.equal(check('u7/x.jpg').errors.length, 1, 'не список');
});

test('ownerBlocker: чужое — 403, снятое модератором — только удалить', () => {
  const ad = { user_id: 7, status: 'open' };
  assert.equal(rules.ownerBlocker(ad, 8, 'edit').status, 403);
  assert.equal(rules.ownerBlocker(ad, 7, 'edit'), null);
  const removed = { user_id: 7, status: 'removed' };
  for (const action of ['edit', 'close', 'reopen', 'bump']) {
    assert.equal(rules.ownerBlocker(removed, 7, action).status, 409, action);
  }
  assert.equal(rules.ownerBlocker(removed, 7, 'delete'), null);
});

test('ownerBlocker: закрыть открытое, открыть закрытое, поднять только открытое', () => {
  const open = { user_id: 7, status: 'open' };
  const closed = { user_id: 7, status: 'closed' };
  assert.equal(rules.ownerBlocker(open, 7, 'close'), null);
  assert.equal(rules.ownerBlocker(closed, 7, 'close').status, 409);
  assert.equal(rules.ownerBlocker(closed, 7, 'reopen'), null);
  assert.equal(rules.ownerBlocker(open, 7, 'reopen').status, 409);
  assert.equal(rules.ownerBlocker(open, 7, 'bump'), null);
  assert.equal(rules.ownerBlocker(closed, 7, 'bump').status, 409);
  assert.equal(rules.ownerBlocker(closed, 7, 'edit'), null, 'закрытое можно поправить');
});

test('услуги и «ищу работу» — обычные виды с ценой', () => {
  for (const kind of ['service', 'job_search']) {
    const { errors, result } = rules.validateAd({ ...OK, kind, price: '1500', price_unit: 'hour' }, { userId: 7 });
    assert.deepEqual(errors, [], kind);
    assert.equal(result.kind, kind);
    assert.equal(result.price, 1500);
    assert.equal(result.price_unit, 'hour');
  }
});

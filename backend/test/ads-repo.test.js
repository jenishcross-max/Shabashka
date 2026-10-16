// Объявления на живом SQL (PGlite в памяти, см. helpers/pglite.js): фильтры и
// сортировка ленты, переходы статуса только из ожидаемого, снятое модератором
// не возвращается ни правкой, ни лентой.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const repo = requireSrc('adsRepo.js');

let seq = 0;
async function user(name = 'Айгуль') {
  seq += 1;
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash) VALUES ($1, $2, '+996700000000', 'x') RETURNING *`,
    [name, `ad${seq}@test.kg`]
  );
  return rows[0];
}

const FIELDS = {
  kind: 'rent_out',
  category: 'rest',
  title: 'Номер в пансионате',
  description: 'На двоих, у самого озера',
  price: 2500,
  price_unit: 'day',
  city: 'Чолпон-Ата',
  address: null,
  whatsapp_phone: '+996700123456',
  photos: [],
};

async function newAd(owner, extra = {}) {
  return repo.get(await repo.create(owner.id, { ...FIELDS, ...extra }));
}

// Каждый тест ищет только свои объявления: лента общая на весь файл.
const ids = (ads) => ads.map((a) => a.id);

test('создание и чтение: фото — список путей, имя автора на месте', async () => {
  const owner = await user('Бакыт');
  const ad = await newAd(owner, { photos: ['u1/a.jpg', 'u1/b.jpg'] });
  assert.equal(ad.owner_name, 'Бакыт');
  assert.deepEqual(ad.photos, ['u1/a.jpg', 'u1/b.jpg']);
  assert.equal(ad.status, 'open');
  assert.equal(ad.price, 2500);
  assert.equal(await repo.get(999999), null);
});

test('лента: фильтры по виду, рубрике, городу, словам и цене', async () => {
  const owner = await user();
  const marker = `маркер${Date.now()}`;
  const flat = await newAd(owner, { kind: 'rent_out', category: 'housing', city: 'Бишкек', title: `Квартира ${marker}`, price: 30000, price_unit: 'month' });
  const car = await newAd(owner, { kind: 'sell', category: 'transport', city: 'Ош', title: `Машина ${marker}`, price: 900000, price_unit: 'total' });
  const sofa = await newAd(owner, { kind: 'free', category: 'home', city: 'Бишкек', title: `Диван ${marker}`, price: null, price_unit: null });

  const find = async (filters) => ids((await repo.list({ q: marker, ...filters })).ads);
  assert.deepEqual((await find({})).sort(), [flat.id, car.id, sofa.id].sort());
  assert.deepEqual(await find({ kind: 'sell' }), [car.id]);
  assert.deepEqual(await find({ category: 'housing' }), [flat.id]);
  assert.deepEqual((await find({ city: 'бишк' })).sort(), [flat.id, sofa.id].sort());
  assert.deepEqual(await find({ priceMin: 100000 }), [car.id]);
  assert.deepEqual(await find({ priceMax: 50000 }), [flat.id], 'без цены в диапазон не попадает');
  const { total } = await repo.list({ q: marker, limit: 1 });
  assert.equal(total, 3);
});

test('сортировка: дешевле и дороже — договорные в конце, поднятое выше нового', async () => {
  const owner = await user();
  const marker = `сорт${Date.now()}`;
  const cheap = await newAd(owner, { title: `Дёшево ${marker}`, price: 100 });
  const deal = await newAd(owner, { title: `Договорная ${marker}`, price: null, price_unit: null });
  const dear = await newAd(owner, { title: `Дорого ${marker}`, price: 5000 });

  assert.deepEqual(ids((await repo.list({ q: marker, sort: 'cheap' })).ads), [cheap.id, dear.id, deal.id]);
  assert.deepEqual(ids((await repo.list({ q: marker, sort: 'expensive' })).ads), [dear.id, cheap.id, deal.id]);

  await repo.bump(cheap.id);
  assert.equal(ids((await repo.list({ q: marker })).ads)[0], cheap.id);
});

test('в ленте только открытые; переходы статуса — только из ожидаемого', async () => {
  const owner = await user();
  const marker = `статус${Date.now()}`;
  const ad = await newAd(owner, { title: `Велосипед ${marker}` });

  assert.equal(await repo.setStatus(ad.id, owner.id, 'closed', 'open'), false, 'открытое не открывают');
  assert.equal(await repo.setStatus(ad.id, (await user()).id, 'open', 'closed'), false, 'чужое не закрыть');
  assert.equal(await repo.setStatus(ad.id, owner.id, 'open', 'closed'), true);
  assert.deepEqual(ids((await repo.list({ q: marker })).ads), []);
  assert.equal(await repo.setStatus(ad.id, owner.id, 'closed', 'open'), true);
  assert.deepEqual(ids((await repo.list({ q: marker })).ads), [ad.id]);
});

test('правка меняет поля, но снятое модератором не оживает', async () => {
  const owner = await user();
  const ad = await newAd(owner);
  assert.equal(await repo.update(ad.id, { ...FIELDS, title: 'Новый заголовок', photos: ['u1/c.jpg'] }), true);
  const fresh = await repo.get(ad.id);
  assert.equal(fresh.title, 'Новый заголовок');
  assert.deepEqual(fresh.photos, ['u1/c.jpg']);

  assert.equal(await repo.removeByModerator(ad.id), true);
  assert.equal(await repo.removeByModerator(ad.id), false, 'дважды не снимают');
  assert.equal(await repo.update(ad.id, { ...FIELDS, title: 'Обход модерации' }), false);
  assert.equal((await repo.get(ad.id)).status, 'removed');
});

test('удаление: только своё, возвращает пути фото', async () => {
  const owner = await user();
  const ad = await newAd(owner, { photos: ['u5/x.jpg'] });
  assert.equal(await repo.remove(ad.id, (await user()).id), null, 'чужое не удалить');
  assert.deepEqual(await repo.remove(ad.id, owner.id), ['u5/x.jpg']);
  assert.equal(await repo.get(ad.id), null);
});

test('мои — все свои статусы; пакет для избранного — без снятых', async () => {
  const owner = await user();
  const open = await newAd(owner);
  const closed = await newAd(owner);
  const removed = await newAd(owner);
  await repo.setStatus(closed.id, owner.id, 'open', 'closed');
  await repo.removeByModerator(removed.id);

  assert.deepEqual(ids(await repo.mine(owner.id)).sort(), [open.id, closed.id, removed.id].sort());
  assert.deepEqual(ids(await repo.batch([open.id, closed.id, removed.id])).sort(), [open.id, closed.id].sort());
  assert.deepEqual(await repo.batch([]), []);
});

test('просмотры считаются', async () => {
  const ad = await newAd(await user());
  await repo.addView(ad.id);
  await repo.addView(ad.id);
  assert.equal((await repo.get(ad.id)).views, 2);
});

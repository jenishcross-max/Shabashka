// Ролик «Топ-5 объявлений» (src/digestRepo.js): с октября 2026 объявления не
// записки доски, а раздел «Объявления» — выпуск берёт их оттуда. PGlite в памяти.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const digest = requireSrc('digestRepo.js');

test('«Объявления дня» — открытые объявления за окно выпуска', async () => {
  const { rows } = await db.query(
    "INSERT INTO users (name, email, phone, password_hash) VALUES ('Айгуль', 'dg@test.kg', '+996700000000', 'x') RETURNING id"
  );
  const add = (title, status = 'open') =>
    db.query(
      `INSERT INTO ads (user_id, kind, category, title, description, price, price_unit, city, whatsapp_phone, status)
       VALUES ($1, 'sell', 'things', $2, 'Почти новый', 3000, 'total', 'Бишкек', '+996700111222', $3)`,
      [rows[0].id, title, status]
    );
  await add('Продаю диван');
  await add('Продано', 'closed');

  const { items, total } = await digest.pick('board');
  assert.equal(total, 1);
  assert.equal(items[0].listingType, 'board');
  assert.deepEqual(items[0].parsed, {
    title: 'Продаю диван',
    description: 'Почти новый',
    category: null,
    city: 'Бишкек',
    budget: 3000,
    phone: '+996700111222',
  });
});

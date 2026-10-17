// Формы на сайте: заказ, вакансия, записка на доске. Посты из групп фильтр
// (src/spam.js) проверял всегда, а поданное прямо на сайте — нет: так в августе
// 2026 вышел заказ «съездить в Алматы и открыть Kaspi на загранпаспорт».
// Здесь форма отказывает только в запрещённом — оформлении на чужие документы;
// обычная подача проходит как раньше. База — PGlite в памяти.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const pass = (_req, _res, next) => next();
const requireSrc = install({
  [at('db/index.js')]: db,
  [at('rateLimit.js')]: new Proxy({}, { get: () => pass }),
});

const { signToken } = requireSrc('middleware/auth.js');
const app = express();
app.use(express.json());
app.use('/api/orders', requireSrc('routes/orders.js'));
app.use('/api/vacancies', requireSrc('routes/vacancies.js'));
app.use('/api/board', requireSrc('routes/board.js'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

const SCAM =
  'Подработка 1000 сом, 15 минут. Нотариус, доверенность на авто. Без ЗАГСа. Только паспорт или Тундук. Возраст 18+. Парни и девушки.';
const KASPI = 'Подработка на день. Алматага барып каспи ачтырабыз, загранпаспорт керек болот. Оплата 10000';

let base = '';
let server;
let author;
test.before(async () => {
  // Эти колонки добавляет не schema.sql, а db/index.js при старте.
  for (const table of ['orders', 'vacancies']) {
    for (const column of ['for_students', 'is_example', 'is_imported']) {
      await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} BOOLEAN NOT NULL DEFAULT false`);
    }
  }
  await db.query("INSERT INTO categories (name) VALUES ('Другое') ON CONFLICT DO NOTHING");
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
     VALUES ('Автор', 'forms@test.kg', '+996700003001', 'x', true, 'customer') RETURNING *`
  );
  author = rows[0];
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

async function call(path, body, method = 'POST') {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken(author)}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const ORDER = { title: 'Подработка', category: 'Другое', city: 'Бишкек', work_format: 'offline' };
const VACANCY = {
  title: 'Подработка',
  description: 'Работа на день',
  category: 'Другое',
  employment_type: 'gig',
  city: 'Бишкек',
  work_format: 'offline',
  experience: 'no_experience',
};

test('заказ: схему не принимает ни при подаче, ни при правке', async () => {
  for (const description of [SCAM, KASPI]) {
    const res = await call('/orders', { ...ORDER, description });
    assert.equal(res.status, 400, description);
    assert.match(res.body.error, /на чужое имя/);
  }

  const ok = await call('/orders', { ...ORDER, description: 'Нужно перевезти диван с 5 мкр на Восток-5, 1500 сом' });
  assert.equal(ok.status, 201);
  // Подал безобидное, потом переписал — правка проверяется так же.
  const edit = await call(`/orders/${ok.body.order.id}`, { description: SCAM }, 'PATCH');
  assert.equal(edit.status, 400);
  assert.match(edit.body.error, /на чужое имя/);
});

test('вакансия: схема в требованиях — тоже схема', async () => {
  const res = await call('/vacancies', { ...VACANCY, requirements: SCAM });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /на чужое имя/);

  const ok = await call('/vacancies', { ...VACANCY, requirements: 'Паспорт, опыт не нужен, кыздар жана балдар' });
  assert.equal(ok.status, 201);
});

test('доска: записку со схемой не вешает', async () => {
  const res = await call('/board', { text: SCAM, city: 'Бишкек' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /на чужое имя/);

  const ok = await call('/board', { text: 'Нужен грузчик на 2 часа, 1000 сом', city: 'Бишкек' });
  assert.equal(ok.status, 201);
});

// Список вакансий с фильтрами страниц /rabota/bez-opyta и /rabota/onlayn
// (поиск 24 ноября 2026: «работа бишкек без опыта» и «онлайн работа» — сотни
// показов в Google, а страниц под них не было). Настоящий SQL — PGlite в памяти.
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

const app = express();
app.use('/api/vacancies', requireSrc('routes/vacancies.js'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

let base = '';
let server;
test.before(async () => {
  await db.query('ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS is_example BOOLEAN NOT NULL DEFAULT false');
  await db.query(
    "INSERT INTO users (name, email, phone, password_hash) VALUES ('Админ', 'a@test', '0700000000', 'x')"
  );
  const add = (title, experience, workFormat, city = 'Бишкек') =>
    db.query(
      `INSERT INTO vacancies (user_id, title, description, category, employment_type, city, work_format, experience)
       VALUES (1, $1, 'Описание', 'Общепит', 'full_time', $2, $3, $4)`,
      [title, city, workFormat, experience]
    );
  await add('Официант', 'no_experience', 'offline');
  await add('Повар', '1-3', 'offline');
  await add('Оператор чата', 'no_experience', 'online');
  await add('Повар в Караколе', '3-6', 'offline', 'Каракол');
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/vacancies`;
});
test.after(() => server.close());

const titles = async (query) => {
  const res = await fetch(`${base}?${new URLSearchParams(query)}`);
  assert.equal(res.status, 200);
  const data = await res.json();
  return { titles: data.vacancies.map((v) => v.title).sort(), total: data.total };
};

test('без опыта — только вакансии, где опыт не нужен', async () => {
  const { titles: list, total } = await titles({ experience: 'no_experience' });
  assert.deepEqual(list, ['Оператор чата', 'Официант']);
  assert.equal(total, 2);
});

test('онлайн — только удалённые вакансии', async () => {
  const { titles: list } = await titles({ workFormat: 'online' });
  assert.deepEqual(list, ['Оператор чата']);
});

test('незнакомое значение фильтра не ломает список', async () => {
  const { total } = await titles({ experience: "1' OR 1=1", workFormat: 'везде' });
  assert.equal(total, 4);
});

test('город и опыт вместе', async () => {
  const { titles: list } = await titles({ city: 'Бишкек', experience: '1-3' });
  assert.deepEqual(list, ['Повар']);
});

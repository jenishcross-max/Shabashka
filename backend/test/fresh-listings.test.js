// Свежесть на сайте (маркетинговое исследование 18 октября 2026, см.
// docs/research): 38% открытых вакансий были старше месяца — человек звонил, а
// место давно занято. А с карточки вакансии некуда было идти дальше: похожих,
// как у заказов, не было. Здесь — закрытие старых объявлений из чатов
// (src/staleListings.js) и «Ещё вакансии» под карточкой. База — PGlite в памяти.
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

const stale = requireSrc('staleListings.js');
const landings = requireSrc('landings.js');
const app = express();
app.use(express.json());
app.use('/api/vacancies', requireSrc('routes/vacancies.js'));
app.use('/api/orders', requireSrc('routes/orders.js'));
app.use(requireSrc('meta.js'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

let base = '';
let server;
let userId;
test.before(async () => {
  // Эти колонки добавляет не schema.sql, а db/index.js при старте.
  for (const table of ['orders', 'vacancies']) {
    for (const column of ['for_students', 'is_example', 'is_imported']) {
      await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} BOOLEAN NOT NULL DEFAULT false`);
    }
  }
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
     VALUES ('Бот', 'fresh@test.kg', '+996700004001', 'x', true, 'customer') RETURNING id`
  );
  userId = rows[0].id;
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

// Вакансия «days» дней назад; остальное — как у объявления из чата.
async function vacancy({ title = 'Официант', category = 'Общепит', city = 'Бишкек', days = 0, ...rest } = {}) {
  const row = {
    is_imported: true,
    pinned: 0,
    status: 'open',
    bumped_days: null,
    ...rest,
  };
  const { rows } = await db.query(
    `INSERT INTO vacancies (user_id, title, description, category, employment_type, city, work_format, experience,
                            is_imported, pinned, status, created_at, bumped_at)
     VALUES ($1, $2, 'Описание', $3, 'gig', $4, 'offline', 'no_experience', $5, $6, $7,
             NOW() - make_interval(days => $8::int),
             CASE WHEN $9::int IS NULL THEN NULL ELSE NOW() - make_interval(days => $9::int) END)
     RETURNING id`,
    [userId, title, category, city, row.is_imported, row.pinned, row.status, days, row.bumped_days]
  );
  return rows[0].id;
}

async function order({ days = 0, is_imported = true } = {}) {
  const { rows } = await db.query(
    `INSERT INTO orders (user_id, title, description, category, city, work_format, is_imported, created_at)
     VALUES ($1, 'Перевезти диван', 'Описание', 'Грузоперевозки', 'Бишкек', 'offline', $2,
             NOW() - make_interval(days => $3::int))
     RETURNING id`,
    [userId, is_imported, days]
  );
  return rows[0].id;
}

const statusOf = async (table, id) => (await db.query(`SELECT status FROM ${table} WHERE id = $1`, [id])).rows[0].status;

test('старые объявления из чатов закрываются, свои, закреплённые и поднятые — нет', async () => {
  const oldVacancy = await vacancy({ days: 22 });
  const freshVacancy = await vacancy({ days: 20 });
  const ownVacancy = await vacancy({ days: 60, is_imported: false });
  const pinnedVacancy = await vacancy({ days: 60, pinned: 1 });
  const bumpedVacancy = await vacancy({ days: 40, bumped_days: 2 });
  const oldOrder = await order({ days: 15 });
  const freshOrder = await order({ days: 13 });
  const ownOrder = await order({ days: 60, is_imported: false });

  const closed = await stale.closeStale();
  assert.deepEqual(closed, { vacancies: 1, orders: 1 });

  assert.equal(await statusOf('vacancies', oldVacancy), 'closed', 'вакансия из чата живёт три недели');
  assert.equal(await statusOf('vacancies', freshVacancy), 'open');
  assert.equal(await statusOf('vacancies', ownVacancy), 'open', 'своё автор закрывает сам');
  assert.equal(await statusOf('vacancies', pinnedVacancy), 'open', 'закреплённое — оплачено');
  assert.equal(await statusOf('vacancies', bumpedVacancy), 'open', 'срок считается от поднятия');
  assert.equal(await statusOf('orders', oldOrder), 'closed', 'разовый заказ — две недели');
  assert.equal(await statusOf('orders', freshOrder), 'open');
  assert.equal(await statusOf('orders', ownOrder), 'open');

  assert.deepEqual(await stale.closeStale(), { vacancies: 0, orders: 0 }, 'второй проход ничего не трогает');
});

test('«Ещё вакансии»: та же категория и город впереди, без себя, закрытых и просмотров', async () => {
  await db.query('DELETE FROM vacancies');
  const current = await vacancy({ title: 'Официант в кафе' });
  const sameBoth = await vacancy({ title: 'Официантка' });
  const otherCity = await vacancy({ title: 'Официант в Оше', city: 'Ош' });
  const otherCategory = await vacancy({ title: 'Грузчик', category: 'Другое' });
  await vacancy({ title: 'Закрытая', status: 'closed' });
  const older = await vacancy({ title: 'Бармен', days: 3 });

  const res = await fetch(`${base}/vacancies/${current}/similar`);
  assert.equal(res.status, 200);
  const { vacancies } = await res.json();
  const ids = vacancies.map((v) => v.id);
  assert.ok(!ids.includes(current), 'без самой вакансии');
  assert.ok(!vacancies.some((v) => v.title === 'Закрытая'));
  assert.equal(ids.length, 4);
  assert.deepEqual(ids.slice(0, 2), [sameBoth, older], 'сначала та же категория в том же городе, свежие выше');
  assert.ok(ids.indexOf(otherCity) < ids.indexOf(otherCategory), 'потом та же категория в другом городе');

  const { rows } = await db.query('SELECT SUM(views)::int AS n FROM vacancies');
  assert.equal(rows[0].n, 0, 'подборка не считается просмотром');

  const missing = await fetch(`${base}/vacancies/999999/similar`);
  assert.deepEqual(await missing.json(), { vacancies: [] });
});

// «Другое» — у 87% вакансий из чатов (см. исследование). Подбирать по нему —
// то же, что подбирать наугад, поэтому такой вакансии отдаём просто свежие
// из её города.
test('у вакансии из «Другого» — свежие из того же города', async () => {
  await db.query('DELETE FROM vacancies');
  const current = await vacancy({ title: 'Нужны парни', category: 'Другое' });
  const fresh = await vacancy({ title: 'Повар', category: 'Общепит' });
  const otherCity = await vacancy({ title: 'Повар в Оше', category: 'Общепит', city: 'Ош' });
  const older = await vacancy({ title: 'Кассир', category: 'Другое', days: 2 });

  const { vacancies } = await (await fetch(`${base}/vacancies/${current}/similar`)).json();
  assert.deepEqual(
    vacancies.map((v) => v.id),
    [fresh, older, otherCity]
  );
});

// «Подработка на сегодня» (посадочная /rabota/segodnya): заказы за сутки, считая
// от поднятия, если оно было.
test('заказы за сутки — fresh=1', async () => {
  await db.query('DELETE FROM orders');
  const today = await order({ days: 0 });
  await order({ days: 2 });
  const bumped = await order({ days: 3 });
  await db.query("UPDATE orders SET bumped_at = NOW() - interval '1 hour' WHERE id = $1", [bumped]);

  const { orders, total } = await (await fetch(`${base}/orders?fresh=1&limit=48`)).json();
  assert.equal(total, 2);
  assert.deepEqual(orders.map((o) => o.id).sort(), [today, bumped].sort());
  assert.equal((await (await fetch(`${base}/orders?limit=48`)).json()).total, 3, 'без fresh — все');
});

test('посадочные страницы — в sitemap', async () => {
  const xml = await (await fetch(`${base.replace(/\/api$/, '')}/sitemap.xml`)).text();
  for (const { slug } of landings) assert.match(xml, new RegExp(`/rabota/${slug}</loc>`), slug);
});

// С фильтром «Для студентов» у категорий стояли общие числа («Ремонт 66»), а в
// выдаче — ноль. С ?students=1 числа — только по объявлениям для студентов.
test('category-counts: ?students=1 считает только объявления для студентов', async () => {
  await db.query("UPDATE vacancies SET status = 'closed'");
  await db.query("UPDATE orders SET status = 'closed'");
  await vacancy({ category: 'Охрана' });
  const forStudents = await vacancy({ category: 'Продажи' });
  await db.query('UPDATE vacancies SET for_students = true WHERE id = $1', [forStudents]);
  await order();

  const all = await (await fetch(`${base}/vacancies/category-counts`)).json();
  assert.deepEqual(all.counts, { Охрана: 1, Продажи: 1 });
  assert.equal(all.students, 1);
  const students = await (await fetch(`${base}/vacancies/category-counts?students=1`)).json();
  assert.deepEqual(students.counts, { Продажи: 1 });

  assert.deepEqual((await (await fetch(`${base}/orders/category-counts`)).json()).counts, { Грузоперевозки: 1 });
  assert.deepEqual((await (await fetch(`${base}/orders/category-counts?students=1`)).json()).counts, {});
});

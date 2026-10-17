// Проверка опубликованного фильтром (src/spamSweep.js, /api/admin/spam-sweep).
// Фильтр смотрит только новые посты, а то, что успело выйти до правки правил,
// так и висит. В октябре 2026 это была сотня с лишним «доверенностей за
// подработку» и «помощников администратора». Здесь — что админка находит, что
// снимает и что не трогает. База — PGlite в памяти.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });

const { signToken } = requireSrc('middleware/auth.js');
const app = express();
app.use(express.json());
app.use('/api/admin', requireSrc('routes/admin.js'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

const SCAM =
  'Подработка 1000сом. Нотариуска барып автоунаага доверенность жаздыруу керек. Кыздар жана балдар, 18+. ЗАГСтагылар кабыл алынбайт';
const MLM =
  'Помощник администратора в офис! Всему научим, карьерный рост, от 16 до 40 лет с паспортом, знание кыргызского, ответственность';

let base = '';
let server;
let admin;
let owner;
test.before(async () => {
  // Эти колонки добавляет не schema.sql, а db/index.js при старте.
  await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT false');
  await db.query('ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT false');
  await db.query('ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS requirements TEXT');
  await db.query('ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS conditions TEXT');
  await db.query('ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT false');
  admin = await user('Админ', 'admin');
  owner = await user('Бот', 'customer');
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

let seq = 0;
async function user(name, role) {
  seq += 1;
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
     VALUES ($1, $2, $3, 'x', true, $4) RETURNING *`,
    [name, `sweep${seq}@test.kg`, `+99670000200${seq}`, role]
  );
  return rows[0];
}

async function call(path, { as = admin, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken(as)}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function order(description, { status = 'open', phone = null, imported = false } = {}) {
  const { rows } = await db.query(
    `INSERT INTO orders (user_id, title, description, category, city, whatsapp_phone, status, is_imported)
     VALUES ($1, 'Подработка', $2, 'Другое', 'Бишкек', $3, $4, $5) RETURNING id`,
    [owner.id, description, phone, status, imported]
  );
  return rows[0].id;
}

async function vacancy(fields) {
  const { rows } = await db.query(
    `INSERT INTO vacancies (user_id, title, description, requirements, category, city, employment_type, is_imported)
     VALUES ($1, $2, $3, $4, 'Другое', 'Бишкек', 'full', true) RETURNING id`,
    [owner.id, fields.title, fields.description, fields.requirements || null]
  );
  return rows[0].id;
}

async function boardPost(text, { hidden = false } = {}) {
  const { rows } = await db.query(
    `INSERT INTO board_posts (user_id, text, city, hidden, is_imported) VALUES ($1, $2, 'Бишкек', $3, true) RETURNING id`,
    [owner.id, text, hidden]
  );
  return rows[0].id;
}

// Объявление из группы — бывшая записка «Доски».
async function ad(description) {
  const { rows } = await db.query(
    `INSERT INTO ads (user_id, kind, category, title, description, city, whatsapp_phone, is_imported)
     VALUES ($1, 'service', 'other', 'Подработка', $2, 'Бишкек', '+996700123456', true) RETURNING id`,
    [owner.id, description]
  );
  return rows[0].id;
}

async function imported(column, id, { isAd = false } = {}) {
  const { rows } = await db.query(
    `INSERT INTO imported_listings (source, raw_text, status, ${column}, is_ad)
     VALUES ('group', 'текст', 'published', $1, $2) RETURNING id`,
    [id, isAd]
  );
  return rows[0].id;
}

test('находит мусор среди опубликованного и не трогает остальное', async () => {
  const scamOrder = await order(SCAM, { phone: '+996700123456', imported: true });
  const importId = await imported('order_id', scamOrder);
  const okOrder = await order('Нужен сантехник срочно, 8й мкр, 2000с');
  const closedScam = await order(SCAM, { status: 'closed' });
  // Опасное может сидеть не в описании, а в требованиях вакансии.
  const scamVacancy = await vacancy({ title: 'Подработка', description: 'Срочно, 1000 сом', requirements: SCAM });
  // Сетевой маркетинг за деньги админ выкладывать вправе (см. spam.js).
  const paidMlm = await vacancy({ title: 'Помощник администратора', description: MLM });
  await imported('vacancy_id', paidMlm, { isAd: true });
  const freeMlm = await vacancy({ title: 'Помощник администратора', description: MLM });
  const scamBoard = await boardPost(SCAM);
  const scamAd = await ad(SCAM);
  await boardPost(SCAM, { hidden: true });

  assert.equal((await call('/admin/spam-sweep', { as: owner })).status, 403);

  const { status, body } = await call('/admin/spam-sweep');
  assert.equal(status, 200);
  const found = body.items.map((i) => `${i.type}:${i.id}`).sort();
  assert.deepEqual(
    found,
    [`order:${scamOrder}`, `vacancy:${scamVacancy}`, `vacancy:${freeMlm}`, `board:${scamBoard}`, `ad:${scamAd}`].sort()
  );
  const item = body.items.find((i) => i.type === 'order');
  assert.equal(item.kind, 'drop');
  assert.match(item.reason, /на чужое имя/);
  assert.equal(item.is_imported, true);
  assert.ok(item.excerpt.includes('доверенность'));

  // Снимаем заказ, вакансию — и по ошибке честный заказ: его фильтр не
  // отмечает, поэтому сервер его не снимет, что бы ни прислала страница.
  const res = await call('/admin/spam-sweep', {
    body: {
      items: [
        { type: 'order', id: scamOrder },
        { type: 'vacancy', id: scamVacancy },
        { type: 'ad', id: scamAd },
        { type: 'order', id: okOrder },
        { type: 'users', id: admin.id },
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { removed: 3, blocked: 1 });

  const left = async (table, id) => (await db.query(`SELECT id FROM ${table} WHERE id = $1`, [id])).rows.length;
  assert.equal(await left('orders', scamOrder), 0);
  assert.equal(await left('vacancies', scamVacancy), 0);
  assert.equal(await left('ads', scamAd), 0);
  assert.equal(await left('orders', okOrder), 1);
  assert.equal(await left('orders', closedScam), 1);
  assert.equal(await left('users', admin.id), 1);

  // След в журнале модерации — на случай разбора «что там было».
  const { rows: log } = await db.query(
    "SELECT listing_type, actor, reason FROM moderation_log WHERE listing_id = $1 AND listing_type = 'order'",
    [scamOrder]
  );
  assert.equal(log.length, 1);
  assert.equal(log[0].actor, `admin:${admin.id}`);
  assert.match(log[0].reason, /на чужое имя/);

  // Бот больше не предлагает снять этот импорт: снят уже.
  const { rows: imp } = await db.query('SELECT status FROM imported_listings WHERE id = $1', [importId]);
  assert.equal(imp[0].status, 'rejected');

  // Номер вербовщика — в чёрный список: завтра он пришлёт то же другими словами.
  const { rows: blocked } = await db.query("SELECT phone FROM blocked_phones WHERE phone = '+996700123456'");
  assert.equal(blocked.length, 1);

  const again = (await call('/admin/spam-sweep')).body.items.map((i) => `${i.type}:${i.id}`).sort();
  assert.deepEqual(again, [`vacancy:${freeMlm}`, `board:${scamBoard}`].sort());
});

test('пустой или кривой запрос ничего не снимает', async () => {
  assert.deepEqual((await call('/admin/spam-sweep', { body: {} })).body, { removed: 0, blocked: 0 });
  assert.deepEqual(
    (await call('/admin/spam-sweep', { body: { items: [{ type: 'order', id: 'abc' }, null, 'x'] } })).body,
    { removed: 0, blocked: 0 }
  );
});

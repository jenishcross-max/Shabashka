// Выборки для подборок (см. src/rubricsRepo.js) на живом SQL — PGlite в памяти.
// Здесь — свежие вакансии для WhatsApp-канала (см. src/whatsapp/digest.js):
// только новее прошлой подборки и по одной на работодателя.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const repo = requireSrc('rubricsRepo.js');

let userId;
test.before(async () => {
  // Эту колонку добавляет не schema.sql, а db/index.js при старте.
  await db.query('ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS is_example BOOLEAN NOT NULL DEFAULT false');
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
     VALUES ('Бот', 'repo@test.kg', '+996700004002', 'x', true, 'customer') RETURNING id`
  );
  userId = rows[0].id;
});

async function vacancy({
  title,
  phone = null,
  hours = 1,
  status = 'open',
  example = false,
  salary = 30000,
  category = 'Общепит',
}) {
  const { rows } = await db.query(
    `INSERT INTO vacancies (user_id, title, description, category, employment_type, city, salary_min,
                            whatsapp_phone, status, is_example, created_at)
     VALUES ($1, $2, 'Описание', $8, 'full_time', 'Бишкек', $3, $4, $5, $6,
             NOW() - make_interval(hours => $7::int))
     RETURNING id`,
    [userId, title, salary, phone, status, example, hours, category]
  );
  return rows[0].id;
}

test('свежие вакансии: новее курсора, открытые, за сутки, по одной на номер', async () => {
  const before = await vacancy({ title: 'Уже была в подборке', phone: '+996700000001' });
  await vacancy({ title: 'Позавчерашняя', phone: '+996700000002', hours: 30 });
  await vacancy({ title: 'Закрытая', phone: '+996700000003', status: 'closed' });
  await vacancy({ title: 'Пример', phone: '+996700000004', example: true });
  await vacancy({ title: 'Повар (старое)', phone: '+996700000005', hours: 4 });
  const cook = await vacancy({ title: 'Повар', phone: '+996700000005', hours: 3 });
  const noPhone1 = await vacancy({ title: 'Без номера 1', phone: '', hours: 2 });
  const noPhone2 = await vacancy({ title: 'Без номера 2', phone: null, hours: 2 });

  const items = await repo.freshVacancies({ afterId: before, limit: 5 });
  assert.deepEqual(
    items.map((v) => v.id),
    [noPhone2, noPhone1, cook].sort((a, b) => b - a),
    'свежие сверху; у повара с двумя объявлениями — одно, без номера — каждое своё'
  );
  assert.equal(items.find((v) => v.id === cook).parsed.title, 'Повар', 'у работодателя — самое новое');
  assert.equal(items[0].listingType, 'vacancy');
  assert.deepEqual(items[0].salary, { min: 30000, max: null });
});

test('свежие вакансии: не больше limit', async () => {
  const items = await repo.freshVacancies({ afterId: 0, limit: 2 });
  assert.equal(items.length, 2);
});

// Вечерние рубрики (см. src/telegram/rubrics.js, аудит 12 ноября 2026).
test('рубрика спроса: только названные профессии за сутки, свежие сверху, по одной на номер', async () => {
  const loader = await vacancy({ title: 'Грузчик', phone: '+996700000101', hours: 2, category: 'Склад и грузчики' });
  const office = await vacancy({ title: 'Офис-менеджер', phone: '+996700000102', hours: 1, category: 'Офис' });
  await vacancy({ title: 'Грузчик (повтор)', phone: '+996700000101', hours: 5, category: 'Склад и грузчики' });
  await vacancy({ title: 'Каменщик вчера', phone: '+996700000103', hours: 30, category: 'Стройка и разнорабочие' });
  const items = await repo.byCategories(['Склад и грузчики', 'Офис', 'Стройка и разнорабочие'], { hours: 24 });
  assert.deepEqual(items.map((v) => v.id), [office, loader]);
});

test('оплата за день: сумма от 300 до 4 999 сом, крупные сверху', async () => {
  const shift = await vacancy({ title: 'Грузчик на день', phone: '+996700000201', salary: 2000 });
  const banquet = await vacancy({ title: 'Официант на банкет', phone: '+996700000202', salary: 1500 });
  await vacancy({ title: 'Мусор в сумме', phone: '+996700000203', salary: 10 });
  await vacancy({ title: 'Оклад', phone: '+996700000204', salary: 40000 });
  const items = await repo.dailyPay({ hours: 24 });
  assert.deepEqual(items.map((v) => v.id), [shift, banquet]);
});

test('сколько вакансий вышло за сутки — открытые, без примеров', async () => {
  const n = await repo.countFresh({ hours: 24 });
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM vacancies
      WHERE status = 'open' AND NOT is_example AND created_at > NOW() - INTERVAL '24 hours'`
  );
  assert.equal(n, rows[0].n);
  assert.ok(n > 0);
});

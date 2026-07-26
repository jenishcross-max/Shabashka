// Заполняет БД витринными объявлениями-примерами (is_example = true), не трогая
// реальных пользователей и их объявления. Безопасно перезапускать — старые
// примеры удаляются и создаются заново.
// Использование: node src/seedExamples.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');
const categoriesRepo = require('./categoriesRepo');
const {
  CITIES,
  TEMPLATES,
  VACANCY_TEMPLATES,
  EMPLOYMENT_VALUES,
  SCHEDULES,
  EXPERIENCE_VALUES,
  REQUIREMENTS_POOL,
  CONDITIONS_POOL,
  pickWorkFormat,
  randInt,
  pick,
  daysAgoTimestamp,
} = require('./demoContent');

const EXAMPLE_OWNER_EMAIL = 'examples@shabashka.kg';

async function getOrCreateExampleOwner() {
  const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [EXAMPLE_OWNER_EMAIL]);
  if (rows.length > 0) return rows[0].id;

  const passwordHash = bcrypt.hashSync(require('crypto').randomBytes(24).toString('hex'), 10);
  const inserted = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, city) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    ['Пример объявления', EXAMPLE_OWNER_EMAIL, '+996700000001', passwordHash, 'Бишкек']
  );
  return inserted.rows[0].id;
}

async function main() {
  await db.init();
  const CATEGORIES = await categoriesRepo.listNames();
  const ownerId = await getOrCreateExampleOwner();

  console.log('Удаляю старые примеры…');
  await db.query('DELETE FROM orders WHERE is_example = true');
  await db.query('DELETE FROM vacancies WHERE is_example = true');

  console.log('Создаю примеры заказов…');
  let orderCount = 0;
  let pinnedCount = 0;
  for (const category of CATEGORIES) {
    const templates = TEMPLATES[category] || TEMPLATES['Другое'];
    for (const t of templates) {
      const city = pick(CITIES);
      const daysAgo = randInt(0, 21);
      const pinned = pinnedCount < 3 && Math.random() < 0.15 ? 1 : 0;
      if (pinned) pinnedCount++;
      const budget = t.budget ? randInt(t.budget[0], t.budget[1]) : null;

      await db.query(
        `INSERT INTO orders (user_id, title, description, category, city, work_format, budget, whatsapp_phone, status, views, pinned, is_example, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', $9, $10, true, $11)`,
        [
          ownerId,
          t.title,
          t.description,
          category,
          city,
          pickWorkFormat(category),
          budget,
          null,
          randInt(0, 120),
          pinned,
          daysAgoTimestamp(daysAgo),
        ]
      );
      orderCount++;
    }
  }

  console.log('Создаю примеры вакансий…');
  let vacancyCount = 0;
  let vacancyPinnedCount = 0;
  for (const category of CATEGORIES) {
    const templates = VACANCY_TEMPLATES[category] || VACANCY_TEMPLATES['Другое'];
    for (const t of templates) {
      const city = pick(CITIES);
      const daysAgo = randInt(0, 21);
      const pinned = vacancyPinnedCount < 2 && Math.random() < 0.2 ? 1 : 0;
      if (pinned) vacancyPinnedCount++;

      await db.query(
        `INSERT INTO vacancies
          (user_id, title, description, category, employment_type, city, work_format, experience,
           requirements, conditions, salary_min, salary_max, schedule, whatsapp_phone, status, views, pinned, is_example, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'open', $15, $16, true, $17)`,
        [
          ownerId,
          t.title,
          t.description,
          category,
          pick(EMPLOYMENT_VALUES),
          city,
          pickWorkFormat(category),
          pick(EXPERIENCE_VALUES),
          pick(REQUIREMENTS_POOL),
          pick(CONDITIONS_POOL),
          t.salary ? t.salary[0] : null,
          t.salary ? t.salary[1] : null,
          pick(SCHEDULES),
          null,
          randInt(0, 90),
          pinned,
          daysAgoTimestamp(daysAgo),
        ]
      );
      vacancyCount++;
    }
  }

  console.log(`
Готово!
  Примеров заказов: ${orderCount}
  Примеров вакансий: ${vacancyCount}
`);

  await db.pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

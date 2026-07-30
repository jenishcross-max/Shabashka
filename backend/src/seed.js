// Заполняет базу реалистичными демо-данными для показа сайта.
// Использование: node src/seed.js
// ВНИМАНИЕ: полностью очищает users/orders/vacancies/reports перед заполнением.
// Только для локальной разработки — на проде используйте seedExamples.js, он не трогает реальных пользователей.
require('dotenv').config();
const crypto = require('crypto');
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

const CUSTOMERS = [
  ['Азамат Токтогулов', 'azamat.t'],
  ['Гульнара Садыкова', 'gulnara.s'],
  ['Данияр Кубанов', 'daniyar.k'],
  ['Айгерим Бекова', 'aigerim.b'],
  ['Марат Жумабеков', 'marat.j'],
  ['Нурбек Осмонов', 'nurbek.o'],
  ['Чолпон Асанова', 'cholpon.a'],
  ['Эркин Мамбетов', 'erkin.m'],
  ['Жаныл Törökulova', 'janyl.t'],
  ['Бакыт Раимкулов', 'bakyt.r'],
  ['Салтанат Дүйшеева', 'saltanat.d'],
  ['Тилек Абдразаков', 'tilek.a'],
];

async function main() {
  await db.init();
  const CATEGORIES = await categoriesRepo.listNames();

  console.log('Очищаю старые данные…');
  await db.query('TRUNCATE TABLE reports RESTART IDENTITY CASCADE');
  await db.query('TRUNCATE TABLE orders RESTART IDENTITY CASCADE');
  await db.query('TRUNCATE TABLE vacancies RESTART IDENTITY CASCADE');
  await db.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE');

  const passwordHash = bcrypt.hashSync('password123', 10);
  const adminPassword = crypto.randomBytes(9).toString('base64url');
  const adminHash = bcrypt.hashSync(adminPassword, 10);

  console.log('Создаю администратора…');
  await db.query(
    `INSERT INTO users (name, email, phone, password_hash, city, role) VALUES ($1, $2, $3, $4, $5, 'admin')`,
    ['Азамат Админов', 'admin@shabashka.kg', '+996700000000', adminHash, 'Бишкек']
  );

  console.log('Создаю пользователей…');
  const userIds = [];
  for (let i = 0; i < CUSTOMERS.length; i++) {
    const [name, slug] = CUSTOMERS[i];
    const city = pick(CITIES);
    const phone = `+9967001${String(10000 + i * 137).slice(-5)}`;
    const inserted = await db.query(
      `INSERT INTO users (name, email, phone, password_hash, city) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, `${slug}@example.com`, phone, passwordHash, city]
    );
    userIds.push({ id: inserted.rows[0].id, name, phone, city });
  }

  console.log('Создаю заказы…');
  const orderIds = [];
  let pinnedCount = 0;
  for (const category of CATEGORIES) {
    const templates = TEMPLATES[category] || TEMPLATES['Другое'];
    for (const t of templates) {
      const owner = pick(userIds);
      const city = Math.random() < 0.6 ? owner.city : pick(CITIES);
      const daysAgo = randInt(0, 40);
      const status = Math.random() < 0.82 ? 'open' : 'closed';
      const pinned = status === 'open' && pinnedCount < 3 && Math.random() < 0.15 ? 1 : 0;
      if (pinned) pinnedCount++;
      const budget = t.budget ? randInt(t.budget[0], t.budget[1]) : null;

      const inserted = await db.query(
        `INSERT INTO orders (user_id, title, description, category, city, work_format, budget, whatsapp_phone, status, views, pinned, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          owner.id,
          t.title,
          t.description,
          category,
          city,
          pickWorkFormat(category),
          budget,
          null, // демо-объявления — без номера, номера в диапазоне +996 700 1xxxx могут принадлежать реальным людям
          status,
          randInt(0, 240),
          pinned,
          daysAgoTimestamp(daysAgo),
        ]
      );
      orderIds.push(inserted.rows[0].id);
    }
  }

  console.log('Создаю вакансии…');
  const vacancyIds = [];
  let vacancyPinnedCount = 0;
  for (const category of CATEGORIES) {
    const templates = VACANCY_TEMPLATES[category] || VACANCY_TEMPLATES['Другое'];
    for (const t of templates) {
      const owner = pick(userIds);
      const city = Math.random() < 0.6 ? owner.city : pick(CITIES);
      const daysAgo = randInt(0, 30);
      const status = Math.random() < 0.85 ? 'open' : 'closed';
      const pinned = status === 'open' && vacancyPinnedCount < 2 && Math.random() < 0.2 ? 1 : 0;
      if (pinned) vacancyPinnedCount++;

      const inserted = await db.query(
        `INSERT INTO vacancies
          (user_id, title, description, category, employment_type, city, work_format, experience,
           requirements, conditions, salary_min, salary_max, schedule, whatsapp_phone, status, views, pinned, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
        [
          owner.id,
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
          null, // демо-объявления — без номера, номера в диапазоне +996 700 1xxxx могут принадлежать реальным людям
          status,
          randInt(0, 180),
          pinned,
          daysAgoTimestamp(daysAgo),
        ]
      );
      vacancyIds.push(inserted.rows[0].id);
    }
  }

  console.log('Добавляю несколько жалоб…');
  const reasons = [
    'Похоже на спам / нереальная цена',
    'Заказчик не отвечает в WhatsApp',
    'Дублирующее объявление',
    'Подозрение на мошенничество',
  ];
  for (let i = 0; i < 4; i++) {
    await db.query(
      "INSERT INTO reports (listing_type, listing_id, reason, resolved) VALUES ('order', $1, $2, $3)",
      [pick(orderIds), pick(reasons), Math.random() < 0.5 ? 1 : 0]
    );
  }

  console.log(`
Готово!
  Пользователей: ${userIds.length + 1} (включая администратора)
  Заказов: ${orderIds.length}
  Вакансий: ${vacancyIds.length}
  Пароль для всех демо-заказчиков: password123
  Админ: admin@shabashka.kg / ${adminPassword}
`);

  await db.pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

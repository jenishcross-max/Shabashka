// Вакансия, поданная на сайте, раньше оставалась только на сайте: в группу,
// Threads и Instagram уходили одни объявления из чатов (аудит 12 ноября 2026, см.
// docs/research/2026-11-audit.md). Своих вакансий поэтому почти не было —
// работодателю незачем подавать туда, где его никто не увидит. Теперь бот
// раздаёт её так же, как объявление из чата (src/telegram/siteShare.js). База — PGlite.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const siteShare = requireSrc('telegram/siteShare.js');
const feedStats = requireSrc('telegram/feedStats.js');

const spread = [];
const deps = { spread: async (importId, parsed, vacancy) => spread.push({ importId, parsed, vacancy }) };

let userId;
let otherId;
test.before(async () => {
  // Эти колонки добавляет не schema.sql, а db/index.js при старте.
  await db.query('ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS for_students BOOLEAN NOT NULL DEFAULT false');
  await db.query('ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS is_example BOOLEAN NOT NULL DEFAULT false');
  const user = (email, phone) =>
    db.query(
      `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
       VALUES ('Работодатель', $1, $2, 'x', true, 'customer') RETURNING id`,
      [email, phone]
    );
  userId = (await user('boss@test.kg', '+996700007001')).rows[0].id;
  otherId = (await user('boss2@test.kg', '+996700007002')).rows[0].id;
});

const vacancy = async (title, owner = userId, extra = {}) =>
  (
    await db.query(
      `INSERT INTO vacancies (user_id, title, description, category, employment_type, city, work_format, experience,
                              salary_min, whatsapp_phone, is_example)
       VALUES ($1, $2, 'Работа в кафе', 'Общепит', 'full_time', 'Бишкек', 'offline', 'no_experience', 40000,
               '+996 555 11 22 33', $3) RETURNING *`,
      [owner, title, Boolean(extra.is_example)]
    )
  ).rows[0];

test('почта подтверждена — вакансия уходит в группу и соцсети, её можно снять через бота', async () => {
  const v = await vacancy('Повар');
  const before = (await feedStats.day())['site.shared'] || 0;
  assert.equal(await siteShare.share(v, { verified: true }, deps), true);
  assert.equal(spread.length, 1);
  const { importId, parsed, vacancy: shared } = spread[0];
  assert.equal(shared.id, v.id);
  assert.deepEqual(
    { title: parsed.title, category: parsed.category, city: parsed.city, budget: parsed.budget, phone: parsed.phone },
    { title: 'Повар', category: 'Общепит', city: 'Бишкек', budget: 40000, phone: '+996 555 11 22 33' }
  );
  assert.equal(parsed.listing_type, 'vacancy');
  // Строка импорта — та же, что у объявлений из чатов: по ней «🔎 Найти и снять»
  // в боте найдёт и снимет вакансию с сайта и из соцсетей.
  const { rows } = await db.query('SELECT source, status, vacancy_id FROM imported_listings WHERE id = $1', [importId]);
  assert.deepEqual(rows[0], { source: 'site', status: 'published', vacancy_id: v.id });
  assert.equal(((await feedStats.day())['site.shared'] || 0) - before, 1);
});

test('без подтверждённой почты и пример — не раздаём', async () => {
  spread.length = 0;
  assert.equal(await siteShare.share(await vacancy('Официант'), { verified: false }, deps), false);
  assert.equal(await siteShare.share(await vacancy('Пример', userId, { is_example: true }), { verified: true }, deps), false);
  assert.equal(spread.length, 0);
});

test('не больше трёх в сутки от одного автора — иначе это уже поток', async () => {
  spread.length = 0;
  // Одна уже ушла в первом тесте.
  assert.equal(await siteShare.share(await vacancy('Бариста'), { verified: true }, deps), true);
  assert.equal(await siteShare.share(await vacancy('Кассир'), { verified: true }, deps), true);
  assert.equal(await siteShare.share(await vacancy('Мойщик'), { verified: true }, deps), false);
  assert.equal(spread.length, 2);
  // У другого автора своя норма.
  assert.equal(await siteShare.share(await vacancy('Грузчик', otherId), { verified: true }, deps), true);
});

test('сбой раздачи не роняет размещение', async () => {
  const failing = { spread: async () => { throw new Error('Telegram недоступен'); } };
  assert.equal(await siteShare.share(await vacancy('Курьер', otherId), { verified: true }, failing), false);
});

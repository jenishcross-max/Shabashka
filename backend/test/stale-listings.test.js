// Закрытие копий (src/staleListings.js, closeRepeats). 12 ноября 2026 из 2104
// открытых вакансий 961 были копиями: тот же номер и тот же заголовок, по
// 20–40 штук с одного номера. В разделе «Для студентов» 21 из 51 — одно и то
// же «Продавец-консультант». Повтор теперь поднимает старую карточку (см.
// repeatOf в telegram/imports.js), а копии, что уже висят, закрывает этот проход.
// PGlite в памяти.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const stale = requireSrc('staleListings.js');

let owner;
test.before(async () => {
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
     VALUES ('Бот', 'bot@test.kg', '+996700000001', 'x', true, 'admin') RETURNING id`
  );
  owner = rows[0].id;
});

async function vacancy(title, phone, { daysAgo = 0, imported = true, pinned = 0 } = {}) {
  const { rows } = await db.query(
    `INSERT INTO vacancies (user_id, title, description, category, employment_type, city, work_format, experience,
                            whatsapp_phone, is_imported, pinned, created_at)
     VALUES ($1, $2, 'Описание', 'Другое', 'full_time', 'Бишкек', 'offline', 'no_experience', $3, $4, $5,
             NOW() - make_interval(days => $6::int)) RETURNING id`,
    [owner, title, phone, imported, pinned, daysAgo]
  );
  return rows[0].id;
}

const linked = async (vacancyId, { isAd = false } = {}) =>
  (
    await db.query(
      `INSERT INTO imported_listings (source, raw_text, status, vacancy_id, is_ad)
       VALUES ('group', 'текст', 'published', $1, $2) RETURNING id`,
      [vacancyId, isAd]
    )
  ).rows[0].id;

const status = async (id) => (await db.query('SELECT status FROM vacancies WHERE id = $1', [id])).rows[0].status;

test('копии с того же номера и с тем же заголовком закрываются, свежая остаётся', async () => {
  const oldest = await vacancy('Продавец-консультант', '+996 508 012 004', { daysAgo: 9 });
  const older = await vacancy('ПРОДАВЕЦ консультант!', '0508012004', { daysAgo: 5 });
  const newest = await vacancy('Продавец-консультант', '+996508012004', { daysAgo: 1 });
  const importOld = await linked(oldest);
  // Другой заголовок у того же номера — другая вакансия.
  const cashier = await vacancy('Кассир', '+996508012004', { daysAgo: 3 });
  // Поданное на сайте и закреплённое (за него заплатили) не трогаем.
  const site = await vacancy('Продавец-консультант', '+996508012004', { daysAgo: 4, imported: false });
  const pinned = await vacancy('Продавец-консультант', '+996508012004', { daysAgo: 6, pinned: 1 });
  // Платная реклама поднимается и снимается по-своему (adRaises.js).
  const paidA = await vacancy('Официант', '+996700999888', { daysAgo: 4 });
  const paidB = await vacancy('Официант', '+996700999888', { daysAgo: 2 });
  await linked(paidA, { isAd: true });
  // Без номера — не знаем, тот ли это работодатель.
  const noPhoneA = await vacancy('Грузчик', '', { daysAgo: 4 });
  const noPhoneB = await vacancy('Грузчик', '', { daysAgo: 2 });

  assert.equal(await stale.closeRepeats(), 2);
  assert.equal(await status(oldest), 'closed');
  assert.equal(await status(older), 'closed');
  assert.equal(await status(newest), 'open');
  for (const id of [cashier, site, pinned, paidA, paidB, noPhoneA, noPhoneB]) assert.equal(await status(id), 'open', `#${id}`);

  // «🔎 Найти и снять» по старому посту найдёт оставшуюся карточку.
  const { rows } = await db.query('SELECT vacancy_id FROM imported_listings WHERE id = $1', [importOld]);
  assert.equal(rows[0].vacancy_id, newest);

  assert.equal(await stale.closeRepeats(), 0, 'второй проход ничего не трогает');
  // Строка «🧹 Убрано сегодня» в сводке (см. summary.js).
  const { rows: counted } = await db.query("SELECT SUM(n)::int AS n FROM bot_counters WHERE key = 'tidy.repeats'");
  assert.equal(counted[0].n, 2);
});

test('свежей считается поднятая, а не созданная последней', async () => {
  const bumped = await vacancy('Курьерлерди жумушка алабыз', '0702607005', { daysAgo: 15 });
  await db.query("UPDATE vacancies SET bumped_at = NOW() - INTERVAL '1 hour' WHERE id = $1", [bumped]);
  const created = await vacancy('Курьерлерди жумушка алабыз', '0702607005', { daysAgo: 2 });
  assert.equal(await stale.closeRepeats(), 1);
  assert.equal(await status(bumped), 'open');
  assert.equal(await status(created), 'closed');
});

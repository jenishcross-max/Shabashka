// Вакансия, поданная на сайте, — в Telegram-группу, Threads и Instagram, так же
// как объявление из чата.
//
// До 12 ноября 2026 она оставалась только на сайте: в соцсети уходили одни
// объявления из чатов, и 99% вакансий Шабашки были чужими (аудит, см.
// docs/research/2026-11-audit.md). Работодателю незачем подавать туда, где его
// никто не увидит, — теперь его вакансию видят все подписчики.
//
// Админ не одобряет каждую, как задачу биржи (см. taskShare.js): вакансию уже
// проверил тот же фильтр, что объявления из чатов (spam.js в routes/vacancies.js),
// а ручного времени у владельца на это нет. Ворота другие:
// - почта подтверждена — первую вакансию сайт пускает и без неё (emailGate.js),
//   а одноразовый аккаунт не должен получать охват Шабашки;
// - не пример (is_example);
// - не больше DAILY_LIMIT в сутки от одного автора — иначе это уже поток, а не
//   работодатель.
// Ушедшая вакансия получает строку в imported_listings — как объявление из чата.
// По ней «🔎 Найти и снять» в боте снимет её с сайта и из соцсетей.
const db = require('../db');
const feedStats = require('./feedStats');

const DAILY_LIMIT = 3;

// Поля в том виде, в каком их ждёт публикация объявления из чата (см.
// publicText в bot.js и shareListing в social/index.js).
const parsedOf = (v) => ({
  listing_type: 'vacancy',
  title: v.title,
  description: v.description,
  category: v.category,
  city: v.city,
  address: v.address || null,
  employment_type: v.employment_type,
  experience: v.experience,
  work_format: v.work_format,
  budget: v.salary_min || null,
  phone: v.whatsapp_phone || null,
  for_students: Boolean(v.for_students),
});

async function sharedToday(userId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM imported_listings il JOIN vacancies v ON v.id = il.vacancy_id
      WHERE il.source = 'site' AND v.user_id = $1 AND il.created_at > NOW() - INTERVAL '1 day'`,
    [userId]
  );
  return rows[0].n;
}

// true — раздали. Ошибку не бросаем: вакансия уже на сайте, и сбой Telegram или
// Meta не должен превращаться в ошибку размещения у работодателя.
async function share(vacancy, { verified = false } = {}, deps) {
  try {
    if (!verified || vacancy.is_example) return false;
    if ((await sharedToday(vacancy.user_id)) >= DAILY_LIMIT) return false;
    const parsed = parsedOf(vacancy);
    const { rows } = await db.query(
      `INSERT INTO imported_listings (source, parsed, status, published_at, vacancy_id)
       VALUES ('site', $1, 'published', NOW(), $2) RETURNING id`,
      [JSON.stringify(parsed), vacancy.id]
    );
    await deps.spread(rows[0].id, parsed, vacancy);
    await feedStats.bump('site.shared');
    return true;
  } catch (err) {
    console.error(`[вакансии с сайта] ${vacancy.id} не раздал:`, err.message);
    return false;
  }
}

module.exports = { share, DAILY_LIMIT };

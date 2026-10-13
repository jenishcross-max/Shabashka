const db = require('./db');

// Выборки для рубрик (см. telegram/rubrics.js): утренний топ по зарплате,
// дневная подработка, подборка для студентов и воскресная сводка зарплат. Всё —
// из уже опубликованного на сайте; примеры (is_example) не берём.

// Зарплату выше считаем ошибкой разбора: «300000» вместо «30000» первым номером
// топа — враньё на всю ленту.
const SALARY_MAX = 300000;
// В сводку зарплат — только похожее на месячную: «1500 в день» среди окладов
// утащило бы середину вниз.
const MONTHLY_MIN = 10000;

// В том виде, в каком объявление ждёт ролик (см. runBatch в social/index.js),
// плюс зарплата целиком — для строки поста.
const vacancy = (row) => ({
  id: row.id,
  listingType: 'vacancy',
  salary: { min: row.salary_min, max: row.salary_max },
  parsed: {
    title: row.title,
    description: row.description,
    category: row.category,
    city: row.city,
    budget: row.salary_min,
    phone: row.phone,
    for_students: row.for_students,
  },
});

const order = (row) => ({
  id: row.id,
  listingType: 'order',
  parsed: {
    title: row.title,
    description: row.description,
    category: row.category,
    city: row.city,
    budget: row.budget,
    phone: row.phone,
    for_students: row.for_students,
  },
});

// Одно объявление на номер: работодатель с пятью одинаковыми объявлениями занял
// бы всю подборку. Внутри номера — лучшее по order, снаружи — по нему же. Номера
// нет — у рекламы «как есть» это пустая строка, не NULL: без NULLIF все такие
// объявления слиплись бы в одно.
const WHO = "COALESCE(NULLIF(whatsapp_phone, ''), id::text)";
const VACANCY_FIELDS = `id, title, description, category, city, salary_min, salary_max,
       whatsapp_phone AS phone, for_students, created_at`;

async function topSalary({ days = 2, limit = 5 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (${WHO}) ${VACANCY_FIELDS}
         FROM vacancies
        WHERE status = 'open' AND NOT is_example AND salary_min BETWEEN 1 AND $3
          AND created_at > NOW() - make_interval(days => $1)
        ORDER BY ${WHO}, salary_min DESC
     ) v ORDER BY salary_min DESC LIMIT $2`,
    [days, limit, SALARY_MAX]
  );
  return rows.map(vacancy);
}

async function forStudents({ days = 2, limit = 5 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (${WHO}) ${VACANCY_FIELDS}
         FROM vacancies
        WHERE status = 'open' AND NOT is_example AND for_students
          AND created_at > NOW() - make_interval(days => $1)
        ORDER BY ${WHO}, created_at DESC
     ) v ORDER BY created_at DESC LIMIT $2`,
    [days, limit]
  );
  return rows.map(vacancy);
}

async function freshOrders({ hours = 24, limit = 5 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (${WHO}) id, title, description, category, city, budget,
              whatsapp_phone AS phone, for_students, created_at
         FROM orders
        WHERE status = 'open' AND NOT is_example
          AND created_at > NOW() - make_interval(hours => $1)
        ORDER BY ${WHO}, created_at DESC
     ) o ORDER BY created_at DESC LIMIT $2`,
    [hours, limit]
  );
  return rows.map(order);
}

// Середина зарплат «от» по категориям: медиана, а не среднее — одна вакансия
// «от 200 000» не должна поднимать всю профессию. «Другое» не показываем: это
// не профессия, и сказать про неё «столько платят» нечего. Закрытые за месяц
// вакансии считаем — платили и по ним; а перепост того же работодателя с той же
// зарплатой — один раз: иначе один упорный работодатель и есть «медиана».
async function salaryStats({ city = 'Бишкек', days = 30, minCount = 5, limit = 5 } = {}) {
  const { rows } = await db.query(
    `SELECT category, COUNT(*)::int AS n,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_min))::int AS median
       FROM (
         SELECT DISTINCT ${WHO} AS who, category, salary_min
           FROM vacancies
          WHERE NOT is_example AND city = $1 AND category <> 'Другое'
            AND salary_min BETWEEN $2 AND $3
            AND created_at > NOW() - make_interval(days => $4)
       ) v
      GROUP BY category
     HAVING COUNT(*) >= $5
      ORDER BY n DESC
      LIMIT $6`,
    [city, MONTHLY_MIN, SALARY_MAX, days, minCount, limit]
  );
  return rows;
}

module.exports = { topSalary, forStudents, freshOrders, salaryStats };

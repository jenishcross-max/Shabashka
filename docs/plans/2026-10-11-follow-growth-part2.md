# Подписчики, часть 2: рубрики по расписанию — план реализации

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** Бот сам выпускает рубрики из базы, ради которых на Шабашку подписываются:
утренний топ вакансий по зарплате, дневную подработку, подборку для студентов и
воскресную сводку «Сколько платят в Бишкеке».

**Architecture:** `rubricsRepo.js` — выборки SQL. `telegram/rubrics.js` — расписание
(обход раз в 10 минут, отметка «выпущено сегодня» в `app_settings`), тексты постов и
выход: Threads и ролик Instagram через новую `social.shareRubric` (очередь — как у
рекламы, потолок Instagram — площадочный, пометки «реклама» нет), канал — через
функцию от бота с кнопкой «Подписаться». Итог — в счётчиках сводки.

**Tech Stack:** Node.js, `node:test`, Postgres, Threads/Instagram Graph API, Telegram Bot API.

**Ограничения проекта:** бэкенд локально не запускать; CRLF; комментарии по-русски;
коммит и пуш — по «комит пуш».

| Рубрика | Ключ | Когда (Бишкек) | Откуда | Ролик |
|---|---|---|---|---|
| 💰 Топ-5 вакансий по зарплате | `top` | ежедневно с 9:00 | открытые вакансии за 2 дня с зарплатой, одна на номер | да |
| 🧰 Подработка на сегодня | `orders` | ежедневно с 13:00 | открытые заказы за сутки, одна на номер | да |
| 🎓 Работа для студентов | `students` | пн, ср, пт с 17:00 | вакансии «для студентов» за 2 дня | да |
| 📊 Сколько платят в Бишкеке | `salaries` | вс с 12:00 | медиана «от» по категориям за 30 дней, 5+ вакансий | нет (не из чего собрать кадры) |

Окно выхода — 3 часа от часа рубрики: Render проспал 9:00 — выйдет позже, но не к
вечеру. Меньше 3 объявлений — рубрика в этот день пропускается. Отметку ставим до
выхода: перезапуск посреди выхода лучше потеряет рубрику, чем выложит её дважды.
`RUBRICS` — какие включены (`top,orders,…`), `off` — ни одной.

---

### Task 1: Выборки — `backend/src/rubricsRepo.js`

Без отдельного теста (SQL проверяется на боевой базе только чтением, а тесты базу не
трогают); проверка формы — через тест рубрик с заглушкой.

```js
const db = require('./db');

// Выборки для рубрик (см. telegram/rubrics.js). Всё — из уже опубликованного на
// сайте; примеры (is_example) не берём.

// Зарплату выше считаем ошибкой разбора: «300000» вместо «30000» первым номером
// топа — враньё на всю ленту.
const SALARY_MAX = 300000;
// В сводку зарплат — только похожее на месячную: «1500 в день» среди окладов
// утащило бы середину вниз.
const MONTHLY_MIN = 10000;

// Одна вакансия на номер: работодатель с пятью одинаковыми объявлениями занял бы
// весь топ.
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

async function topSalary({ days = 2, limit = 5 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (COALESCE(whatsapp_phone, id::text)) id, title, description, category, city,
              salary_min, salary_max, whatsapp_phone AS phone, for_students
         FROM vacancies
        WHERE status = 'open' AND NOT is_example AND salary_min BETWEEN 1 AND $3
          AND created_at > NOW() - make_interval(days => $1)
        ORDER BY COALESCE(whatsapp_phone, id::text), salary_min DESC
     ) v ORDER BY salary_min DESC LIMIT $2`,
    [days, limit, SALARY_MAX]
  );
  return rows.map(vacancy);
}

async function forStudents({ days = 2, limit = 5 } = {}) { /* то же, AND for_students, по created_at DESC */ }
async function freshOrders({ hours = 24, limit = 5 } = {}) { /* orders за сутки, одна на номер, по created_at DESC */ }
async function salaryStats({ city = 'Бишкек', days = 30, minCount = 5, limit = 5 } = {}) {
  // SELECT category, COUNT(*)::int AS n,
  //        (percentile_cont(0.5) WITHIN GROUP (ORDER BY salary_min))::int AS median
  //   FROM vacancies WHERE NOT is_example AND city = $1 AND category <> 'Другое'
  //    AND salary_min BETWEEN MONTHLY_MIN AND SALARY_MAX AND created_at > NOW() - $days
  //  GROUP BY category HAVING COUNT(*) >= $minCount ORDER BY n DESC LIMIT $limit
}

module.exports = { topSalary, forStudents, freshOrders, salaryStats };
```

### Task 2: Выход рубрики на площадки — `social.shareRubric`

**Test** (`social-threads.test.js`): рубрика встаёт в Threads перед обычными
объявлениями; ролик уходит в Instagram без пометки рекламы, со строкой «подпишись»;
без объявлений ролика нет (`instagram: null`). Run → FAIL (нет функции).

**Code** (`social/index.js`):

```js
async function shareRubric({ text, items = [], collection, cta }) {
  const toThreads = async () =>
    threads.isConfigured()
      ? paceThreads(() => post('threads', () => publishToThreads({ text })), { priority: true })
      : null;
  const toInstagram = async () => {
    if (!instagram.isConfigured() || !items.length) return null;
    const job = { items, listingType: items[0].listingType, collection, cta, digest: true,
      targets: ['instagram'], priority: true, ad: false, follow: follow.line() };
    return scheduleInstagram(job, true);
  };
  const [th, ig] = await Promise.all([toThreads(), toInstagram()]);
  return { threads: th, instagram: ig };
}
```

`buildForHand`: собирать ролик «для ручной публикации» — только рекламе
(`!job.ad`), не рубрике.

### Task 3: Расписание и тексты — `backend/src/telegram/rubrics.js`

**Test** (`rubrics.test.js`, заглушки repo/social/feedStats/settings):
- 9:05 — выходит `top`; второй обход в тот же день — нет; текст ≤ 500 по `weight`,
  в нём ссылка на все вакансии и «🔔 Подпишись»;
- 8:55 и 12:30 (окно 9–12 прошло) — ничего;
- 13:05 — `orders`; вторник 17:05 — студентов нет, среда 17:05 — есть;
- воскресенье 12:05 — `salaries`, без ролика;
- мало данных — пропуск и счётчик `rub.skip`;
- канал получает пост с HTML-ссылкой;
- `parseList('off')` → `[]`, `parseList('top, x')` → `['top']`.

**Code:** `RUBRICS` с `{ key, hour, days, make }`, `tick(deps, now)`, `start(deps)`,
`fit(post)` — убирает строки с конца, пока пост не влезет в 500 (не меньше 3).

### Task 4: Подключение в бота и сводку

- `bot.js`: `subscribeKeyboard()` (общая с `publishOne`), `rubrics.start({ siteUrl,
  pretty: prettyLink, channel })` в `startWatchers`.
- `summary.js`: строка `📅 Рубрик: 2 · мало данных 1 · не вышло 1`.
  Test в `summary.test.js`.

### Task 5: README, `npm test`, дифф владельцу; коммит — по «комит пуш».

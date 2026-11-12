// Старые объявления из чатов закрываются сами. В октябре 2026 38% открытых
// вакансий были старше месяца (см. docs/research/2026-10-18-marketing-research.md):
// человек звонил, а место давно занято, — и больше на сайт не возвращался.
// Объявление из чата никто не закроет: автор о сайте не знает.
//
// Срок считается от последнего поднятия, если оно было. Не трогаем:
// - поданное на сайте — его автор закрывает и поднимает сам;
// - закреплённое — за него заплатили.
// Закрытое пропадает из ленты и sitemap, а по старой ссылке из Threads человек
// видит «Закрыта», а не звонит впустую.
//
// Тем же проходом:
// - копии одной вакансии закрываются (closeRepeats);
// - опубликованное заново проверяется фильтром мошенников (spamSweep.auto).
const db = require('./db');
const { invalidate } = require('./cache');
const spamSweep = require('./spamSweep');
const { titleKey } = require('./telegram/imports');
const feedStats = require('./telegram/feedStats');

// Вакансия — три недели: набор на смены идёт неделями. Разовый заказ — две:
// за это время его либо сделали, либо он уже никому не нужен.
const VACANCY_DAYS = 21;
const ORDER_DAYS = 14;
const EVERY_MS = 60 * 60 * 1000;

const closeIn = async (table, days) =>
  (
    await db.query(
      `UPDATE ${table} SET status = 'closed'
        WHERE status = 'open' AND is_imported AND pinned = 0
          AND COALESCE(bumped_at, created_at) < NOW() - make_interval(days => $1::int)`,
      [days]
    )
  ).rowCount || 0;

async function closeStale() {
  const vacancies = await closeIn('vacancies', VACANCY_DAYS);
  const orders = await closeIn('orders', ORDER_DAYS);
  if (vacancies || orders) {
    invalidate('home:');
    console.log(`[свежесть] закрыл старые объявления из чатов: вакансий ${vacancies}, заказов ${orders}`);
  }
  return { vacancies, orders };
}

// Копии одной вакансии из чатов: тот же номер (последние 9 цифр — «0508…» и
// «+996 508…» один номер) и тот же заголовок. 12 ноября 2026 таких было 961 из
// 2104 открытых, по 20–40 с одного номера, и в разделе «Для студентов» 21 из 51
// — одно и то же «Продавец-консультант». Новых копий больше не будет (повтор
// поднимает старую карточку, см. repeatOf в telegram/imports.js), а висящие
// закрываем: остаётся последняя поднятая или созданная, импорты копий
// переходят на неё — «🔎 Найти и снять» по старому посту снимет её.
// Не трогаем, как и выше, поданное на сайте и закреплённое, а ещё платную
// рекламу (у неё свои поднятия, см. adRaises.js) и вакансии без номера.
async function closeRepeats() {
  const { rows } = await db.query(
    `SELECT v.id, v.title, v.whatsapp_phone FROM vacancies v
      WHERE v.status = 'open' AND v.is_imported AND v.pinned = 0
        AND NOT EXISTS (SELECT 1 FROM imported_listings il WHERE il.vacancy_id = v.id AND il.is_ad)
      ORDER BY COALESCE(v.bumped_at, v.created_at) DESC, v.id DESC`
  );
  const keepers = new Map();
  const closing = [];
  for (const row of rows) {
    const phone = String(row.whatsapp_phone || '').replace(/\D/g, '').slice(-9);
    const title = titleKey(row.title);
    if (phone.length < 9 || !title) continue;
    const key = `${phone}|${title}`;
    if (keepers.has(key)) closing.push([row.id, keepers.get(key)]);
    else keepers.set(key, row.id);
  }
  if (!closing.length) return 0;
  const ids = closing.map(([id]) => id);
  const keep = closing.map(([, id]) => id);
  await db.query(
    `UPDATE imported_listings il SET vacancy_id = m.keep
       FROM unnest($1::int[], $2::int[]) AS m(id, keep) WHERE il.vacancy_id = m.id`,
    [ids, keep]
  );
  const closed = (await db.query(`UPDATE vacancies SET status = 'closed' WHERE id = ANY($1::int[])`, [ids])).rowCount || 0;
  invalidate('home:');
  console.log(`[свежесть] закрыл копии вакансий из чатов: ${closed}`);
  await feedStats.bump('tidy.repeats', closed);
  return closed;
}

// Сразу при старте и раз в час. Ночью сервис спит (см. keepalive.js) — значит,
// проход просто случится утром.
function start() {
  const run = async () => {
    for (const [name, step] of [
      ['свежесть', closeStale],
      ['копии', closeRepeats],
      ['фильтр', spamSweep.auto],
    ]) {
      await step().catch((err) => console.error(`[${name}]`, err.message));
    }
  };
  run();
  setInterval(run, EVERY_MS).unref();
}

module.exports = { closeStale, closeRepeats, start, VACANCY_DAYS, ORDER_DAYS };

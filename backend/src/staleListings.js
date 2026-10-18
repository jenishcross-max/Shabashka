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
const db = require('./db');
const { invalidate } = require('./cache');

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

// Сразу при старте и раз в час. Ночью сервис спит (см. keepalive.js) — значит,
// проход просто случится утром.
function start() {
  const run = () => closeStale().catch((err) => console.error('[свежесть]', err.message));
  run();
  setInterval(run, EVERY_MS).unref();
}

module.exports = { closeStale, start, VACANCY_DAYS, ORDER_DAYS };

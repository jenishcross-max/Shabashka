const db = require('./db');

// Первое объявление (заказ или вакансия) можно разместить без подтверждения
// почты. Для второго и последующих — почта должна быть подтверждена.
async function canCreateListing(userId, emailVerified) {
  if (emailVerified) return true;

  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM orders WHERE user_id = $1)
          + (SELECT COUNT(*)::int FROM vacancies WHERE user_id = $1) AS n`,
    [userId]
  );
  return rows[0].n === 0;
}

module.exports = { canCreateListing };

const express = require('express');
const db = require('../db');
const categoriesRepo = require('../categoriesRepo');
const KNOWN_CITIES = require('../cities');
const asyncHandler = require('../asyncHandler');
const { cached } = require('../cache');
const { ORDER_FIELDS, VACANCY_FIELDS } = require('../sqlFields');

const router = express.Router();

const REFERENCE_TTL = 60 * 1000; // счётчики и списки обновляются не чаще раза в минуту
const FEED_TTL = 30 * 1000;

// Всё, что нужно главной странице, одним запросом. Раньше она дёргала семь
// разных эндпоинтов, и на медленной связи с базой каждый добавлял свою задержку.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [categories, counts, cityCounts, stats, orders, vacancies, cities] = await Promise.all([
      categoriesRepo.listNames(), // кэшируется внутри репозитория

      cached('home:category-counts', REFERENCE_TTL, async () => {
        const { rows } = await db.query(
          "SELECT category, COUNT(*)::int AS count FROM orders WHERE status = 'open' GROUP BY category"
        );
        return Object.fromEntries(rows.map((r) => [r.category, r.count]));
      }),

      cached('home:city-counts', REFERENCE_TTL, async () => {
        const { rows } = await db.query(
          "SELECT city, COUNT(*)::int AS count FROM orders WHERE status = 'open' GROUP BY city ORDER BY count DESC LIMIT 8"
        );
        return rows;
      }),

      cached('home:stats', REFERENCE_TTL, async () => {
        const { rows } = await db.query(
          `SELECT
             (SELECT COUNT(*) FROM users)::int AS "usersCount",
             (SELECT COUNT(*) FROM orders WHERE status = 'open')::int AS "activeOrders",
             (SELECT COUNT(DISTINCT city) FROM orders WHERE status = 'open')::int AS "citiesCount"`
        );
        return rows[0];
      }),

      cached('home:orders', FEED_TTL, async () => {
        const { rows } = await db.query(
          `SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id
           WHERE orders.status = 'open'
           ORDER BY orders.pinned DESC, orders.created_at DESC LIMIT 6`
        );
        return rows;
      }),

      cached('home:vacancies', FEED_TTL, async () => {
        const { rows } = await db.query(
          `SELECT ${VACANCY_FIELDS} FROM vacancies JOIN users ON users.id = vacancies.user_id
           WHERE vacancies.status = 'open'
           ORDER BY vacancies.pinned DESC, vacancies.created_at DESC LIMIT 3`
        );
        return rows;
      }),

      cached('home:cities', REFERENCE_TTL, async () => {
        const { rows } = await db.query("SELECT DISTINCT city FROM orders WHERE status = 'open'");
        const used = rows.map((r) => r.city);
        return [...new Set([...KNOWN_CITIES, ...used])].sort((a, b) => a.localeCompare(b, 'ru'));
      }),
    ]);

    res.json({ categories, counts, cityCounts, stats, orders, vacancies, cities });
  })
);

module.exports = router;

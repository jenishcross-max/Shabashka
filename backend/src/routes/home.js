const express = require('express');
const db = require('../db');
const KNOWN_CITIES = require('../cities');
const asyncHandler = require('../asyncHandler');
const { cached } = require('../cache');
const { ORDER_FIELDS, VACANCY_FIELDS } = require('../sqlFields');
const instagram = require('../social/instagram');
const tasksRepo = require('../tasksRepo');
const adsRepo = require('../adsRepo');
const { withPhotoUrls } = require('../adsView');

const router = express.Router();

const REFERENCE_TTL = 60 * 1000; // счётчики и списки обновляются не чаще раза в минуту
const FEED_TTL = 30 * 1000;
// Подписчики Instagram считаются в тот же часовой лимит Graph API, что и
// публикация роликов (см. social/instagram.js), а само число за день почти
// не меняется — одного запроса в сутки достаточно, и квоту, нужную для
// постинга, вообще не трогаем.
const INSTAGRAM_TTL = 24 * 60 * 60 * 1000;

// Всё, что нужно главной странице, одним запросом. Раньше она дёргала семь
// разных эндпоинтов, и на медленной связи с базой каждый добавлял свою задержку.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    // Ни счётчиков по категориям, ни общей статистики: главная больше их не
    // показывает, а это были два полных прохода по orders и users на каждое
    // истечение кэша.
    const [cityCounts, orders, vacancies, cities, instagramFollowers, tasks, ads, counts] = await Promise.all([
      cached('home:city-counts', REFERENCE_TTL, async () => {
        const { rows } = await db.query(
          "SELECT city, COUNT(*)::int AS count FROM orders WHERE status = 'open' GROUP BY city ORDER BY count DESC LIMIT 8"
        );
        return rows;
      }),

      cached('home:orders', FEED_TTL, async () => {
        const { rows } = await db.query(
          `SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id
           WHERE orders.status = 'open'
           ORDER BY orders.pinned DESC, orders.created_at DESC LIMIT 8`
        );
        return rows;
      }),

      cached('home:vacancies', FEED_TTL, async () => {
        const { rows } = await db.query(
          `SELECT ${VACANCY_FIELDS} FROM vacancies JOIN users ON users.id = vacancies.user_id
           WHERE vacancies.status = 'open'
           ORDER BY vacancies.pinned DESC, vacancies.created_at DESC LIMIT 6`
        );
        return rows;
      }),

      cached('home:cities', REFERENCE_TTL, async () => {
        const { rows } = await db.query("SELECT DISTINCT city FROM orders WHERE status = 'open'");
        const used = rows.map((r) => r.city);
        return [...new Set([...KNOWN_CITIES, ...used])].sort((a, b) => a.localeCompare(b, 'ru'));
      }),

      // Бейдж с подписчиками — вещь необязательная: если Instagram не настроен
      // или Graph API споткнулся, отдаём null и молчим, а не роняем всю главную.
      cached('home:instagram-followers', INSTAGRAM_TTL, async () => {
        if (!instagram.isConfigured()) return null;
        try {
          return await instagram.followers();
        } catch (err) {
          console.error('Подписчики Instagram:', err.message);
          return null;
        }
      }),

      // Четыре свежие задачи биржи — для блока наверху главной.
      cached('home:tasks', FEED_TTL, async () => (await tasksRepo.list({ limit: 4 })).tasks),

      // Четыре свежих объявления «сдам/продам» — для блока под биржей.
      cached('home:ads', FEED_TTL, async () => (await adsRepo.list({ limit: 4 })).ads.map(withPhotoUrls)),

      // Плитки «Что ищете?»: сколько открыто в каждом разделе. Четыре счёта по
      // индексам статуса одним запросом; сбрасывается вместе со всем home: при
      // каждой подаче, а так — раз в минуту.
      cached('home:counts', REFERENCE_TTL, async () => {
        const { rows } = await db.query(
          `SELECT (SELECT COUNT(*)::int FROM orders WHERE status = 'open') AS orders,
                  (SELECT COUNT(*)::int FROM vacancies WHERE status = 'open') AS vacancies,
                  (SELECT COUNT(*)::int FROM tasks WHERE status = 'open') AS tasks,
                  (SELECT COUNT(*)::int FROM ads WHERE status = 'open') AS ads`
        );
        return rows[0];
      }),
    ]);

    res.json({ cityCounts, orders, vacancies, cities, instagramFollowers, tasks, ads, counts });
  })
);

module.exports = router;

const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const categoriesRepo = require('../categoriesRepo');
const asyncHandler = require('../asyncHandler');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const usersCount = (await db.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n;
    const newUsers30d = (
      await db.query("SELECT COUNT(*)::int AS n FROM users WHERE created_at >= NOW() - INTERVAL '30 days'")
    ).rows[0].n;
    const activeOrders = (await db.query("SELECT COUNT(*)::int AS n FROM orders WHERE status = 'open'")).rows[0].n;
    const activeVacancies = (await db.query("SELECT COUNT(*)::int AS n FROM vacancies WHERE status = 'open'"))
      .rows[0].n;
    const ordersToday = (
      await db.query("SELECT COUNT(*)::int AS n FROM orders WHERE created_at::date = CURRENT_DATE")
    ).rows[0].n;
    const openReports = (await db.query('SELECT COUNT(*)::int AS n FROM reports WHERE resolved = 0')).rows[0].n;

    const weekly = (
      await db.query(
        `SELECT to_char(created_at, 'IYYY-IW') AS week, COUNT(*)::int AS count
         FROM orders
         WHERE created_at >= NOW() - INTERVAL '49 days'
         GROUP BY week
         ORDER BY week ASC`
      )
    ).rows;

    const topCategories = (
      await db.query(
        'SELECT category, COUNT(*)::int AS count FROM orders GROUP BY category ORDER BY count DESC LIMIT 6'
      )
    ).rows;

    res.json({
      usersCount,
      newUsers30d,
      activeOrders,
      activeVacancies,
      ordersToday,
      openReports,
      weekly,
      topCategories,
    });
  })
);

router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, u.city, u.role, u.is_blocked, u.created_at,
              (SELECT COUNT(*) FROM orders WHERE orders.user_id = u.id)::int AS orders_count
       FROM users u
       ORDER BY u.created_at DESC`
    );
    res.json({ users: rows });
  })
);

router.patch(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
    if (target.role === 'admin') return res.status(400).json({ error: 'Нельзя заблокировать администратора' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'Нельзя заблокировать самого себя' });

    const { blocked } = req.body || {};
    if (typeof blocked !== 'boolean') return res.status(400).json({ error: 'Некорректное значение blocked' });

    await db.query('UPDATE users SET is_blocked = $1 WHERE id = $2', [blocked ? 1 : 0, target.id]);
    res.json({ ok: true });
  })
);

router.get(
  '/orders',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT orders.id, orders.title, orders.category, orders.city, orders.budget, orders.status,
              orders.views, orders.pinned, orders.created_at,
              users.name AS owner_name, users.email AS owner_email
       FROM orders
       JOIN users ON users.id = orders.user_id
       ORDER BY orders.pinned DESC, orders.created_at DESC`
    );
    res.json({ orders: rows });
  })
);

router.patch(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query('SELECT id FROM orders WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Заказ не найден' });

    const { status, pinned } = req.body || {};
    const values = [];
    const updates = [];
    const addUpdate = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (status !== undefined) {
      if (!['open', 'closed'].includes(status)) {
        return res.status(400).json({ error: 'Статус может быть только open или closed' });
      }
      addUpdate('status', status);
    }
    if (pinned !== undefined) {
      if (typeof pinned !== 'boolean') return res.status(400).json({ error: 'Некорректное значение pinned' });
      addUpdate('pinned', pinned ? 1 : 0);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Нечего обновлять' });

    values.push(req.params.id);
    await db.query(`UPDATE orders SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
    res.json({ ok: true });
  })
);

router.get(
  '/vacancies',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT vacancies.id, vacancies.title, vacancies.category, vacancies.employment_type,
              vacancies.city, vacancies.salary_min, vacancies.salary_max, vacancies.status,
              vacancies.views, vacancies.pinned, vacancies.created_at,
              users.name AS owner_name, users.email AS owner_email
       FROM vacancies
       JOIN users ON users.id = vacancies.user_id
       ORDER BY vacancies.pinned DESC, vacancies.created_at DESC`
    );
    res.json({ vacancies: rows });
  })
);

router.patch(
  '/vacancies/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query('SELECT id FROM vacancies WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Вакансия не найдена' });

    const { status, pinned } = req.body || {};
    const values = [];
    const updates = [];
    const addUpdate = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (status !== undefined) {
      if (!['open', 'closed'].includes(status)) {
        return res.status(400).json({ error: 'Статус может быть только open или closed' });
      }
      addUpdate('status', status);
    }
    if (pinned !== undefined) {
      if (typeof pinned !== 'boolean') return res.status(400).json({ error: 'Некорректное значение pinned' });
      addUpdate('pinned', pinned ? 1 : 0);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Нечего обновлять' });

    values.push(req.params.id);
    await db.query(`UPDATE vacancies SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
    res.json({ ok: true });
  })
);

router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const onlyOpen = req.query.status !== 'all';
    const { rows } = await db.query(
      `SELECT reports.id, reports.reason, reports.resolved, reports.created_at,
              orders.id AS order_id, orders.title AS order_title, orders.status AS order_status
       FROM reports
       JOIN orders ON orders.id = reports.order_id
       ${onlyOpen ? 'WHERE reports.resolved = 0' : ''}
       ORDER BY reports.created_at DESC`
    );
    res.json({ reports: rows });
  })
);

router.patch(
  '/reports/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query('SELECT * FROM reports WHERE id = $1', [req.params.id]);
    const report = rows[0];
    if (!report) return res.status(404).json({ error: 'Жалоба не найдена' });

    const { action } = req.body || {};
    if (!['hide', 'dismiss'].includes(action)) {
      return res.status(400).json({ error: 'Действие может быть только hide или dismiss' });
    }

    if (action === 'hide') {
      await db.query("UPDATE orders SET status = 'closed' WHERE id = $1", [report.order_id]);
    }
    await db.query('UPDATE reports SET resolved = 1 WHERE id = $1', [report.id]);

    res.json({ ok: true });
  })
);

router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    res.json({ categories: await categoriesRepo.listAll() });
  })
);

router.post(
  '/categories',
  asyncHandler(async (req, res) => {
    try {
      const category = await categoriesRepo.add(req.body?.name);
      res.status(201).json({ category });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  })
);

router.delete(
  '/categories/:id',
  asyncHandler(async (req, res) => {
    try {
      await categoriesRepo.remove(req.params.id);
      res.status(204).end();
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  })
);

module.exports = router;

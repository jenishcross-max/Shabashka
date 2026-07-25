const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const categoriesRepo = require('../categoriesRepo');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/stats', (_req, res) => {
  const usersCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const newUsers30d = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE created_at >= datetime('now', '-30 days')")
    .get().n;
  const activeOrders = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'open'").get().n;
  const activeVacancies = db.prepare("SELECT COUNT(*) AS n FROM vacancies WHERE status = 'open'").get().n;
  const ordersToday = db
    .prepare("SELECT COUNT(*) AS n FROM orders WHERE date(created_at) = date('now')")
    .get().n;
  const openReports = db.prepare('SELECT COUNT(*) AS n FROM reports WHERE resolved = 0').get().n;

  const weekly = db
    .prepare(
      `SELECT strftime('%Y-%W', created_at) AS week, COUNT(*) AS count
       FROM orders
       WHERE created_at >= datetime('now', '-49 days')
       GROUP BY week
       ORDER BY week ASC`
    )
    .all();

  const topCategories = db
    .prepare('SELECT category, COUNT(*) AS count FROM orders GROUP BY category ORDER BY count DESC LIMIT 6')
    .all();

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
});

router.get('/users', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, email, city, role, is_blocked, created_at,
              (SELECT COUNT(*) FROM orders WHERE orders.user_id = users.id) AS orders_count
       FROM users
       ORDER BY created_at DESC`
    )
    .all();
  res.json({ users: rows });
});

router.patch('/users/:id', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.role === 'admin') return res.status(400).json({ error: 'Нельзя заблокировать администратора' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Нельзя заблокировать самого себя' });

  const { blocked } = req.body || {};
  if (typeof blocked !== 'boolean') return res.status(400).json({ error: 'Некорректное значение blocked' });

  db.prepare('UPDATE users SET is_blocked = ? WHERE id = ?').run(blocked ? 1 : 0, target.id);
  res.json({ ok: true });
});

router.get('/orders', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT orders.id, orders.title, orders.category, orders.city, orders.budget, orders.status,
              orders.views, orders.pinned, orders.created_at,
              users.name AS owner_name, users.email AS owner_email
       FROM orders
       JOIN users ON users.id = orders.user_id
       ORDER BY orders.pinned DESC, orders.created_at DESC`
    )
    .all();
  res.json({ orders: rows });
});

router.patch('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  const { status, pinned } = req.body || {};
  const updates = [];
  const values = [];

  if (status !== undefined) {
    if (!['open', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Статус может быть только open или closed' });
    }
    updates.push('status = ?');
    values.push(status);
  }
  if (pinned !== undefined) {
    if (typeof pinned !== 'boolean') return res.status(400).json({ error: 'Некорректное значение pinned' });
    updates.push('pinned = ?');
    values.push(pinned ? 1 : 0);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Нечего обновлять' });

  values.push(order.id);
  db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

router.get('/vacancies', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT vacancies.id, vacancies.title, vacancies.category, vacancies.employment_type,
              vacancies.city, vacancies.salary_min, vacancies.salary_max, vacancies.status,
              vacancies.views, vacancies.pinned, vacancies.created_at,
              users.name AS owner_name, users.email AS owner_email
       FROM vacancies
       JOIN users ON users.id = vacancies.user_id
       ORDER BY vacancies.pinned DESC, vacancies.created_at DESC`
    )
    .all();
  res.json({ vacancies: rows });
});

router.patch('/vacancies/:id', (req, res) => {
  const vacancy = db.prepare('SELECT id FROM vacancies WHERE id = ?').get(req.params.id);
  if (!vacancy) return res.status(404).json({ error: 'Вакансия не найдена' });

  const { status, pinned } = req.body || {};
  const updates = [];
  const values = [];

  if (status !== undefined) {
    if (!['open', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Статус может быть только open или closed' });
    }
    updates.push('status = ?');
    values.push(status);
  }
  if (pinned !== undefined) {
    if (typeof pinned !== 'boolean') return res.status(400).json({ error: 'Некорректное значение pinned' });
    updates.push('pinned = ?');
    values.push(pinned ? 1 : 0);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Нечего обновлять' });

  values.push(vacancy.id);
  db.prepare(`UPDATE vacancies SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

router.get('/reports', (req, res) => {
  const onlyOpen = req.query.status !== 'all';
  const rows = db
    .prepare(
      `SELECT reports.id, reports.reason, reports.resolved, reports.created_at,
              orders.id AS order_id, orders.title AS order_title, orders.status AS order_status
       FROM reports
       JOIN orders ON orders.id = reports.order_id
       ${onlyOpen ? 'WHERE reports.resolved = 0' : ''}
       ORDER BY reports.created_at DESC`
    )
    .all();
  res.json({ reports: rows });
});

router.patch('/reports/:id', (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Жалоба не найдена' });

  const { action } = req.body || {};
  if (!['hide', 'dismiss'].includes(action)) {
    return res.status(400).json({ error: 'Действие может быть только hide или dismiss' });
  }

  if (action === 'hide') {
    db.prepare("UPDATE orders SET status = 'closed' WHERE id = ?").run(report.order_id);
  }
  db.prepare('UPDATE reports SET resolved = 1 WHERE id = ?').run(report.id);

  res.json({ ok: true });
});

router.get('/categories', (_req, res) => {
  res.json({ categories: categoriesRepo.listAll() });
});

router.post('/categories', (req, res) => {
  try {
    const category = categoriesRepo.add(req.body?.name);
    res.status(201).json({ category });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/categories/:id', (req, res) => {
  try {
    categoriesRepo.remove(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

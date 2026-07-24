const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const CATEGORIES = require('../categories');

const router = express.Router();

const ORDER_FIELDS = `
  orders.id, orders.title, orders.description, orders.category, orders.city,
  orders.budget, orders.whatsapp_phone, orders.status, orders.created_at,
  orders.user_id, users.name AS owner_name
`;

router.get('/categories', (_req, res) => {
  res.json({ categories: CATEGORIES });
});

// Публичный список заказов — доступен всем без авторизации
router.get('/', (req, res) => {
  const { category, city, q } = req.query;
  const clauses = ["orders.status = 'open'"];
  const params = {};

  if (category) {
    clauses.push('orders.category = @category');
    params.category = category;
  }
  if (city) {
    clauses.push('orders.city LIKE @city');
    params.city = `%${city}%`;
  }
  if (q) {
    clauses.push('(orders.title LIKE @q OR orders.description LIKE @q)');
    params.q = `%${q}%`;
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id ${where} ORDER BY orders.created_at DESC`
    )
    .all(params);

  res.json({ orders: rows });
});

// Заказы текущего пользователя (заказчика)
router.get('/mine', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id WHERE orders.user_id = ? ORDER BY orders.created_at DESC`
    )
    .all(req.user.id);
  res.json({ orders: rows });
});

router.get('/:id', (req, res) => {
  const row = db
    .prepare(`SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?`)
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Заказ не найден' });
  res.json({ order: row });
});

// Создать заказ — только авторизованные заказчики
router.post('/', requireAuth, (req, res) => {
  const { title, description, category, city, budget, whatsapp_phone } = req.body || {};

  if (!title || !title.trim()) return res.status(400).json({ error: 'Укажите заголовок заказа' });
  if (!description || !description.trim()) return res.status(400).json({ error: 'Опишите заказ' });
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Некорректная категория' });
  if (!city || !city.trim()) return res.status(400).json({ error: 'Укажите город' });

  const phone = String(whatsapp_phone || '').replace(/[^\d+]/g, '');
  if (phone.length < 9) return res.status(400).json({ error: 'Укажите корректный номер WhatsApp' });

  const budgetValue = budget ? Number(budget) : null;
  if (budget && (!Number.isFinite(budgetValue) || budgetValue < 0)) {
    return res.status(400).json({ error: 'Некорректный бюджет' });
  }

  const info = db
    .prepare(
      `INSERT INTO orders (user_id, title, description, category, city, budget, whatsapp_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(req.user.id, title.trim(), description.trim(), category, city.trim(), budgetValue, phone);

  const order = db
    .prepare(`SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?`)
    .get(info.lastInsertRowid);

  res.status(201).json({ order });
});

function loadOwnedOrder(req, res) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'Заказ не найден' });
    return null;
  }
  if (order.user_id !== req.user.id) {
    res.status(403).json({ error: 'Это не ваш заказ' });
    return null;
  }
  return order;
}

// Закрыть/открыть заказ — только владелец
router.patch('/:id', requireAuth, (req, res) => {
  const order = loadOwnedOrder(req, res);
  if (!order) return;

  const { status } = req.body || {};
  if (!['open', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Статус может быть только open или closed' });
  }

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, order.id);
  const updated = db
    .prepare(`SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?`)
    .get(order.id);
  res.json({ order: updated });
});

router.delete('/:id', requireAuth, (req, res) => {
  const order = loadOwnedOrder(req, res);
  if (!order) return;

  db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);
  res.status(204).end();
});

module.exports = router;

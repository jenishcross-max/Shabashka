const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const categoriesRepo = require('../categoriesRepo');
const KNOWN_CITIES = require('../cities');
const { reportLimiter } = require('../rateLimit');

const router = express.Router();

const ORDER_FIELDS = `
  orders.id, orders.title, orders.description, orders.category, orders.city, orders.address,
  orders.budget, orders.whatsapp_phone, orders.status, orders.views, orders.pinned,
  orders.created_at,
  orders.user_id, users.name AS owner_name
`;

const SORTS = {
  new: 'orders.pinned DESC, orders.created_at DESC',
  budget: 'orders.pinned DESC, orders.budget IS NULL, orders.budget DESC',
  priceDesc: 'orders.pinned DESC, orders.budget IS NULL, orders.budget DESC',
  priceAsc: 'orders.pinned DESC, orders.budget IS NULL, orders.budget ASC',
  popular: 'orders.pinned DESC, orders.views DESC',
};

router.get('/categories', (_req, res) => {
  res.json({ categories: categoriesRepo.listNames() });
});

// Список городов для автодополнения — известные + реально встречающиеся в заказах
router.get('/cities', (_req, res) => {
  const used = db
    .prepare("SELECT DISTINCT city FROM orders WHERE status = 'open'")
    .all()
    .map((r) => r.city);
  const cities = [...new Set([...KNOWN_CITIES, ...used])].sort((a, b) => a.localeCompare(b, 'ru'));
  res.json({ cities });
});

// Количество открытых заказов по категориям — для плиток на главной
router.get('/category-counts', (_req, res) => {
  const rows = db
    .prepare("SELECT category, COUNT(*) AS count FROM orders WHERE status = 'open' GROUP BY category")
    .all();
  const counts = Object.fromEntries(rows.map((r) => [r.category, r.count]));
  res.json({ counts });
});

// Количество открытых заказов по городам — для пилюль на главной
router.get('/city-counts', (_req, res) => {
  const rows = db
    .prepare(
      "SELECT city, COUNT(*) AS count FROM orders WHERE status = 'open' GROUP BY city ORDER BY count DESC LIMIT 8"
    )
    .all();
  res.json({ cities: rows });
});

// Публичная сводная статистика — для полосы цифр на главной
router.get('/public-stats', (_req, res) => {
  const usersCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const activeOrders = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'open'").get().n;
  const citiesCount = db
    .prepare("SELECT COUNT(DISTINCT city) AS n FROM orders WHERE status = 'open'")
    .get().n;
  res.json({ usersCount, activeOrders, citiesCount });
});

// Публичный список заказов — доступен всем без авторизации
router.get('/', (req, res) => {
  const { city, q, sort, budgetMin, budgetMax } = req.query;
  const hasBudget = req.query.hasBudget === 'true';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const offset = (page - 1) * limit;

  // category принимает как одно значение, так и список через запятую (мультивыбор)
  const knownCategories = categoriesRepo.listNames();
  const categories = String(req.query.category || '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => knownCategories.includes(c));

  const clauses = ["orders.status = 'open'"];
  const params = {};

  if (categories.length) {
    const placeholders = categories.map((_, i) => `@cat${i}`).join(',');
    categories.forEach((c, i) => {
      params[`cat${i}`] = c;
    });
    clauses.push(`orders.category IN (${placeholders})`);
  }
  if (city) {
    clauses.push('orders.city LIKE @city');
    params.city = `%${city}%`;
  }
  if (q) {
    clauses.push('(orders.title LIKE @q OR orders.description LIKE @q)');
    params.q = `%${q}%`;
  }
  if (hasBudget) {
    clauses.push('orders.budget IS NOT NULL');
  }
  const minVal = Number(budgetMin);
  if (budgetMin && Number.isFinite(minVal)) {
    clauses.push('orders.budget >= @budgetMin');
    params.budgetMin = minVal;
  }
  const maxVal = Number(budgetMax);
  if (budgetMax && Number.isFinite(maxVal)) {
    clauses.push('orders.budget <= @budgetMax');
    params.budgetMax = maxVal;
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const orderBy = SORTS[sort] || SORTS.new;

  const total = db.prepare(`SELECT COUNT(*) AS n FROM orders ${where}`).get(params).n;
  const rows = db
    .prepare(
      `SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id
       ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset });

  res.json({ orders: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
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

// Пакетная выборка по id (для избранного) — не увеличивает счётчик просмотров
router.get('/batch', (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter(Number.isInteger)
    .slice(0, 100);
  if (ids.length === 0) return res.json({ orders: [] });

  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id IN (${placeholders})`
    )
    .all(...ids);
  res.json({ orders: rows });
});

router.get('/:id', (req, res) => {
  db.prepare('UPDATE orders SET views = views + 1 WHERE id = ?').run(req.params.id);
  const row = db
    .prepare(`SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?`)
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Заказ не найден' });
  res.json({ order: row });
});

// Похожие заказы — та же категория, желательно тот же город, без текущего
router.get('/:id/similar', (req, res) => {
  const current = db.prepare('SELECT category, city FROM orders WHERE id = ?').get(req.params.id);
  if (!current) return res.json({ orders: [] });

  const rows = db
    .prepare(
      `SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id
       WHERE orders.status = 'open' AND orders.category = ? AND orders.id != ?
       ORDER BY (orders.city = ?) DESC, orders.created_at DESC
       LIMIT 4`
    )
    .all(current.category, req.params.id, current.city);
  res.json({ orders: rows });
});

function validateOrderFields(body, { partial }) {
  const { title, description, category, city, address, budget, whatsapp_phone } = body;
  const errors = [];
  const result = {};

  if (!partial || title !== undefined) {
    if (!title || !title.trim()) errors.push('Укажите заголовок заказа');
    else result.title = title.trim();
  }
  if (!partial || description !== undefined) {
    if (!description || !description.trim()) errors.push('Опишите заказ');
    else result.description = description.trim();
  }
  if (!partial || category !== undefined) {
    if (!categoriesRepo.listNames().includes(category)) errors.push('Некорректная категория');
    else result.category = category;
  }
  if (!partial || city !== undefined) {
    if (!city || !city.trim()) errors.push('Укажите город');
    else result.city = city.trim();
  }
  if (!partial || address !== undefined) {
    const trimmed = String(address || '').trim();
    if (trimmed.length > 200) errors.push('Адрес слишком длинный (макс. 200 символов)');
    else result.address = trimmed || null;
  }
  if (!partial || whatsapp_phone !== undefined) {
    const phone = String(whatsapp_phone || '').replace(/[^\d+]/g, '');
    if (phone.length < 9) errors.push('Укажите корректный номер WhatsApp');
    else result.whatsapp_phone = phone;
  }
  if (!partial || budget !== undefined) {
    const budgetValue = budget ? Number(budget) : null;
    if (budget && (!Number.isFinite(budgetValue) || budgetValue < 0)) errors.push('Некорректный бюджет');
    else result.budget = budgetValue;
  }

  return { errors, result };
}

// Создать заказ — только авторизованные заказчики
router.post('/', requireAuth, (req, res) => {
  const { errors, result } = validateOrderFields(req.body || {}, { partial: false });
  if (errors.length) return res.status(400).json({ error: errors[0] });

  const info = db
    .prepare(
      `INSERT INTO orders (user_id, title, description, category, city, address, budget, whatsapp_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      result.title,
      result.description,
      result.category,
      result.city,
      result.address,
      result.budget,
      result.whatsapp_phone
    );

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

// Обновить заказ (статус и/или поля) — только владелец
router.patch('/:id', requireAuth, (req, res) => {
  const order = loadOwnedOrder(req, res);
  if (!order) return;

  const updates = [];
  const values = [];

  if (req.body?.status !== undefined) {
    if (!['open', 'closed'].includes(req.body.status)) {
      return res.status(400).json({ error: 'Статус может быть только open или closed' });
    }
    updates.push('status = ?');
    values.push(req.body.status);
  }

  const editableKeys = ['title', 'description', 'category', 'city', 'address', 'budget', 'whatsapp_phone'];
  const hasEditableField = editableKeys.some((k) => req.body?.[k] !== undefined);
  if (hasEditableField) {
    const { errors, result } = validateOrderFields(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors[0] });
    for (const key of editableKeys) {
      if (result[key] !== undefined) {
        updates.push(`${key} = ?`);
        values.push(result[key]);
      }
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'Нечего обновлять' });

  values.push(order.id);
  db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`).run(...values);

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

// Пожаловаться на заказ — доступно всем, без авторизации
router.post('/:id/report', reportLimiter, (req, res) => {
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  const { reason } = req.body || {};
  if (!reason || !reason.trim()) return res.status(400).json({ error: 'Укажите причину жалобы' });

  db.prepare('INSERT INTO reports (order_id, reason) VALUES (?, ?)').run(order.id, reason.trim());
  res.status(201).json({ ok: true });
});

module.exports = router;

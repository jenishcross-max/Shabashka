const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const categoriesRepo = require('../categoriesRepo');
const KNOWN_CITIES = require('../cities');
const { reportLimiter } = require('../rateLimit');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

const ORDER_FIELDS = `
  orders.id, orders.title, orders.description, orders.category, orders.city, orders.address,
  orders.work_format, orders.budget, orders.whatsapp_phone, orders.status, orders.views, orders.pinned,
  orders.created_at,
  orders.user_id, users.name AS owner_name
`;

const WORK_FORMATS = ['online', 'offline'];

const SORTS = {
  new: 'orders.pinned DESC, orders.created_at DESC',
  budget: 'orders.pinned DESC, orders.budget IS NULL, orders.budget DESC',
  priceDesc: 'orders.pinned DESC, orders.budget IS NULL, orders.budget DESC',
  priceAsc: 'orders.pinned DESC, orders.budget IS NULL, orders.budget ASC',
  popular: 'orders.pinned DESC, orders.views DESC',
};

function toId(raw) {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) ? n : null;
}

router.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    res.json({ categories: await categoriesRepo.listNames() });
  })
);

// Список городов для автодополнения — известные + реально встречающиеся в заказах
router.get(
  '/cities',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query("SELECT DISTINCT city FROM orders WHERE status = 'open'");
    const used = rows.map((r) => r.city);
    const cities = [...new Set([...KNOWN_CITIES, ...used])].sort((a, b) => a.localeCompare(b, 'ru'));
    res.json({ cities });
  })
);

// Количество открытых заказов по категориям — для плиток на главной
router.get(
  '/category-counts',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query(
      "SELECT category, COUNT(*)::int AS count FROM orders WHERE status = 'open' GROUP BY category"
    );
    const counts = Object.fromEntries(rows.map((r) => [r.category, r.count]));
    res.json({ counts });
  })
);

// Количество открытых заказов по городам — для пилюль на главной
router.get(
  '/city-counts',
  asyncHandler(async (_req, res) => {
    const { rows } = await db.query(
      "SELECT city, COUNT(*)::int AS count FROM orders WHERE status = 'open' GROUP BY city ORDER BY count DESC LIMIT 8"
    );
    res.json({ cities: rows });
  })
);

// Публичная сводная статистика — для полосы цифр на главной
router.get(
  '/public-stats',
  asyncHandler(async (_req, res) => {
    const usersCount = (await db.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n;
    const activeOrders = (await db.query("SELECT COUNT(*)::int AS n FROM orders WHERE status = 'open'")).rows[0].n;
    const citiesCount = (
      await db.query("SELECT COUNT(DISTINCT city)::int AS n FROM orders WHERE status = 'open'")
    ).rows[0].n;
    res.json({ usersCount, activeOrders, citiesCount });
  })
);

// Публичный список заказов — доступен всем без авторизации
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { city, q, sort, budgetMin, budgetMax } = req.query;
    const hasBudget = req.query.hasBudget === 'true';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const offset = (page - 1) * limit;

    // category принимает как одно значение, так и список через запятую (мультивыбор)
    const knownCategories = await categoriesRepo.listNames();
    const categories = String(req.query.category || '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => knownCategories.includes(c));

    const clauses = ["orders.status = 'open'"];
    const params = [];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (categories.length) {
      const placeholders = categories.map((c) => addParam(c)).join(',');
      clauses.push(`orders.category IN (${placeholders})`);
    }
    if (city) {
      clauses.push(`orders.city ILIKE ${addParam(`%${city}%`)}`);
    }
    if (q) {
      const p = addParam(`%${q}%`);
      clauses.push(`(orders.title ILIKE ${p} OR orders.description ILIKE ${p})`);
    }
    if (hasBudget) {
      clauses.push('orders.budget IS NOT NULL');
    }
    const minVal = Number(budgetMin);
    if (budgetMin && Number.isFinite(minVal)) {
      clauses.push(`orders.budget >= ${addParam(minVal)}`);
    }
    const maxVal = Number(budgetMax);
    if (budgetMax && Number.isFinite(maxVal)) {
      clauses.push(`orders.budget <= ${addParam(maxVal)}`);
    }

    const where = `WHERE ${clauses.join(' AND ')}`;
    const orderBy = SORTS[sort] || SORTS.new;

    const total = (await db.query(`SELECT COUNT(*)::int AS n FROM orders ${where}`, params)).rows[0].n;

    const limitPlaceholder = addParam(limit);
    const offsetPlaceholder = addParam(offset);
    const { rows } = await db.query(
      `SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id
       ${where} ORDER BY ${orderBy} LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      params
    );

    res.json({ orders: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  })
);

// Заказы текущего пользователя (заказчика)
router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id WHERE orders.user_id = $1 ORDER BY orders.created_at DESC`,
      [req.user.id]
    );
    res.json({ orders: rows });
  })
);

// Пакетная выборка по id (для избранного) — не увеличивает счётчик просмотров
router.get(
  '/batch',
  asyncHandler(async (req, res) => {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter(Number.isInteger)
      .slice(0, 100);
    if (ids.length === 0) return res.json({ orders: [] });

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(
      `SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id IN (${placeholders})`,
      ids
    );
    res.json({ orders: rows });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (id === null) return res.status(404).json({ error: 'Заказ не найден' });

    await db.query('UPDATE orders SET views = views + 1 WHERE id = $1', [id]);
    const { rows } = await db.query(
      `SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = $1`,
      [id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'Заказ не найден' });
    res.json({ order: row });
  })
);

// Похожие заказы — та же категория, желательно тот же город, без текущего
router.get(
  '/:id/similar',
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (id === null) return res.json({ orders: [] });

    const { rows: currentRows } = await db.query('SELECT category, city FROM orders WHERE id = $1', [id]);
    const current = currentRows[0];
    if (!current) return res.json({ orders: [] });

    const { rows } = await db.query(
      `SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id
       WHERE orders.status = 'open' AND orders.category = $1 AND orders.id != $2
       ORDER BY (orders.city = $3) DESC, orders.created_at DESC
       LIMIT 4`,
      [current.category, id, current.city]
    );
    res.json({ orders: rows });
  })
);

async function validateOrderFields(body, { partial }) {
  const { title, description, category, city, address, work_format, budget, whatsapp_phone } = body;
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
    const knownCategories = await categoriesRepo.listNames();
    if (!knownCategories.includes(category)) errors.push('Некорректная категория');
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
  if (!partial || work_format !== undefined) {
    if (!WORK_FORMATS.includes(work_format)) errors.push('Укажите формат работы — онлайн или офлайн');
    else result.work_format = work_format;
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
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { errors, result } = await validateOrderFields(req.body || {}, { partial: false });
    if (errors.length) return res.status(400).json({ error: errors[0] });

    const inserted = await db.query(
      `INSERT INTO orders (user_id, title, description, category, city, address, work_format, budget, whatsapp_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        req.user.id,
        result.title,
        result.description,
        result.category,
        result.city,
        result.address,
        result.work_format,
        result.budget,
        result.whatsapp_phone,
      ]
    );

    const { rows } = await db.query(
      `SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = $1`,
      [inserted.rows[0].id]
    );

    res.status(201).json({ order: rows[0] });
  })
);

async function loadOwnedOrder(req, res) {
  const id = toId(req.params.id);
  if (id === null) {
    res.status(404).json({ error: 'Заказ не найден' });
    return null;
  }
  const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
  const order = rows[0];
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
router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await loadOwnedOrder(req, res);
    if (!order) return;

    const values = [];
    const updates = [];
    const addUpdate = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (req.body?.status !== undefined) {
      if (!['open', 'closed'].includes(req.body.status)) {
        return res.status(400).json({ error: 'Статус может быть только open или closed' });
      }
      addUpdate('status', req.body.status);
    }

    const editableKeys = [
      'title',
      'description',
      'category',
      'city',
      'address',
      'work_format',
      'budget',
      'whatsapp_phone',
    ];
    const hasEditableField = editableKeys.some((k) => req.body?.[k] !== undefined);
    if (hasEditableField) {
      const { errors, result } = await validateOrderFields(req.body, { partial: true });
      if (errors.length) return res.status(400).json({ error: errors[0] });
      for (const key of editableKeys) {
        if (result[key] !== undefined) addUpdate(key, result[key]);
      }
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Нечего обновлять' });

    values.push(order.id);
    await db.query(`UPDATE orders SET ${updates.join(', ')} WHERE id = $${values.length}`, values);

    const { rows } = await db.query(
      `SELECT ${ORDER_FIELDS} FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = $1`,
      [order.id]
    );
    res.json({ order: rows[0] });
  })
);

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const order = await loadOwnedOrder(req, res);
    if (!order) return;

    await db.query('DELETE FROM orders WHERE id = $1', [order.id]);
    res.status(204).end();
  })
);

// Пожаловаться на заказ — доступно всем, без авторизации
router.post(
  '/:id/report',
  reportLimiter,
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (id === null) return res.status(404).json({ error: 'Заказ не найден' });

    const { rows } = await db.query('SELECT id FROM orders WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Заказ не найден' });

    const { reason } = req.body || {};
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Укажите причину жалобы' });

    await db.query('INSERT INTO reports (order_id, reason) VALUES ($1, $2)', [id, reason.trim()]);
    res.status(201).json({ ok: true });
  })
);

module.exports = router;

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const categoriesRepo = require('../categoriesRepo');
const asyncHandler = require('../asyncHandler');
const moderation = require('../moderation');

function generateTempPassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '');
}

function pagination(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

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
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const q = (req.query.q || '').trim();

    const params = [];
    let where = '';
    if (q) {
      const p = `%${q}%`;
      params.push(p, p, p);
      where = `WHERE u.name ILIKE $1 OR u.email ILIKE $2 OR u.city ILIKE $3`;
    }

    const total = (await db.query(`SELECT COUNT(*)::int AS n FROM users u ${where}`, params)).rows[0].n;

    const { rows } = await db.query(
      `SELECT u.id, u.name, u.email, u.city, u.role, u.is_blocked, u.created_at,
              (SELECT COUNT(*) FROM orders WHERE orders.user_id = u.id)::int AS orders_count
       FROM users u
       ${where}
       ORDER BY u.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json({ users: rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
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
  '/users/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT id, name, email, phone, city, role, is_blocked, created_at FROM users WHERE id = $1`,
      [req.params.id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const orders = (
      await db.query(
        `SELECT id, title, status, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [user.id]
      )
    ).rows;
    const vacancies = (
      await db.query(
        `SELECT id, title, status, created_at FROM vacancies WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [user.id]
      )
    ).rows;

    res.json({ user, orders, vacancies });
  })
);

router.post(
  '/users/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
    if (target.role === 'admin' && target.id !== req.user.id) {
      return res.status(400).json({ error: 'Нельзя сбросить пароль другому администратору' });
    }

    const tempPassword = generateTempPassword();
    const passwordHash = bcrypt.hashSync(tempPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, target.id]);

    res.json({ ok: true, password: tempPassword });
  })
);

router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const q = (req.query.q || '').trim();

    const params = [];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    let where = '';
    if (q) {
      const idParam = addParam(q);
      const likeParam = addParam(`%${q}%`);
      where = `WHERE orders.id::text = ${idParam}
               OR orders.title ILIKE ${likeParam}
               OR users.name ILIKE ${likeParam}
               OR orders.city ILIKE ${likeParam}
               OR orders.category ILIKE ${likeParam}`;
    }

    const total = (
      await db.query(
        `SELECT COUNT(*)::int AS n FROM orders JOIN users ON users.id = orders.user_id ${where}`,
        params
      )
    ).rows[0].n;

    const { rows } = await db.query(
      `SELECT orders.id, orders.title, orders.category, orders.city, orders.budget, orders.status,
              orders.views, orders.pinned, orders.bumped_at, orders.created_at,
              users.name AS owner_name, users.email AS owner_email
       FROM orders
       JOIN users ON users.id = orders.user_id
       ${where}
       ORDER BY orders.pinned DESC, COALESCE(orders.bumped_at, orders.created_at) DESC
       LIMIT ${addParam(limit)} OFFSET ${addParam(offset)}`,
      params
    );
    res.json({ orders: rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
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

// Удаляем со снимком в журнал модерации: после DELETE от заказа не остаётся
// ничего, а вопрос «что там было написано» приходит уже после удаления.
router.delete(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const removed = await moderation.removeWithLog({
      listingType: 'order',
      listingId: req.params.id,
      actor: `admin:${req.user.id}`,
    });
    if (!removed) return res.status(404).json({ error: 'Заказ не найден' });
    res.status(204).end();
  })
);

// Поднять заказ в списке — из админки можно в любой момент, без ограничения раз в сутки
router.post(
  '/orders/:id/bump',
  asyncHandler(async (req, res) => {
    const { rowCount } = await db.query('UPDATE orders SET bumped_at = NOW() WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Заказ не найден' });
    res.json({ ok: true });
  })
);

router.get(
  '/vacancies',
  asyncHandler(async (req, res) => {
    const { page, limit, offset } = pagination(req);
    const q = (req.query.q || '').trim();

    const params = [];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    let where = '';
    if (q) {
      const idParam = addParam(q);
      const likeParam = addParam(`%${q}%`);
      where = `WHERE vacancies.id::text = ${idParam}
               OR vacancies.title ILIKE ${likeParam}
               OR users.name ILIKE ${likeParam}
               OR vacancies.city ILIKE ${likeParam}
               OR vacancies.category ILIKE ${likeParam}`;
    }

    const total = (
      await db.query(
        `SELECT COUNT(*)::int AS n FROM vacancies JOIN users ON users.id = vacancies.user_id ${where}`,
        params
      )
    ).rows[0].n;

    const { rows } = await db.query(
      `SELECT vacancies.id, vacancies.title, vacancies.category, vacancies.employment_type,
              vacancies.city, vacancies.salary_min, vacancies.salary_max, vacancies.status,
              vacancies.views, vacancies.pinned, vacancies.bumped_at, vacancies.created_at,
              users.name AS owner_name, users.email AS owner_email
       FROM vacancies
       JOIN users ON users.id = vacancies.user_id
       ${where}
       ORDER BY vacancies.pinned DESC, COALESCE(vacancies.bumped_at, vacancies.created_at) DESC
       LIMIT ${addParam(limit)} OFFSET ${addParam(offset)}`,
      params
    );
    res.json({ vacancies: rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
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

router.delete(
  '/vacancies/:id',
  asyncHandler(async (req, res) => {
    const removed = await moderation.removeWithLog({
      listingType: 'vacancy',
      listingId: req.params.id,
      actor: `admin:${req.user.id}`,
    });
    if (!removed) return res.status(404).json({ error: 'Вакансия не найдена' });
    res.status(204).end();
  })
);

// Поднять вакансию в списке — из админки можно в любой момент, без ограничения раз в сутки
router.post(
  '/vacancies/:id/bump',
  asyncHandler(async (req, res) => {
    const { rowCount } = await db.query('UPDATE vacancies SET bumped_at = NOW() WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Вакансия не найдена' });
    res.json({ ok: true });
  })
);

// Доска живёт без модерации на входе — гость может написать что угодно, поэтому
// админке нужно быстро скрыть или удалить объявление и закрепить полезное сверху.
// Просроченные чистим тем же способом, что и на публичной доске: перед чтением.
router.get(
  '/board',
  asyncHandler(async (req, res) => {
    await db.query('DELETE FROM board_posts WHERE expires_at <= NOW()');

    const { page, limit, offset } = pagination(req);
    const q = (req.query.q || '').trim();

    const params = [];
    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    let where = '';
    if (q) {
      const idParam = addParam(q);
      const likeParam = addParam(`%${q}%`);
      where = `WHERE board_posts.id::text = ${idParam}
               OR board_posts.text ILIKE ${likeParam}
               OR board_posts.city ILIKE ${likeParam}
               OR COALESCE(users.name, board_posts.author_name) ILIKE ${likeParam}`;
    }

    const total = (
      await db.query(
        `SELECT COUNT(*)::int AS n FROM board_posts LEFT JOIN users ON users.id = board_posts.user_id ${where}`,
        params
      )
    ).rows[0].n;

    const { rows } = await db.query(
      `SELECT board_posts.id, board_posts.text, board_posts.city, board_posts.whatsapp_phone,
              board_posts.pinned, board_posts.hidden, board_posts.created_at, board_posts.expires_at,
              board_posts.user_id, board_posts.guest_id,
              COALESCE(users.name, board_posts.author_name) AS author_name, users.email AS owner_email
       FROM board_posts
       LEFT JOIN users ON users.id = board_posts.user_id
       ${where}
       ORDER BY board_posts.pinned DESC, board_posts.created_at DESC
       LIMIT ${addParam(limit)} OFFSET ${addParam(offset)}`,
      params
    );
    res.json({ posts: rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  })
);

router.patch(
  '/board/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query('SELECT id FROM board_posts WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Объявление не найдено' });

    const { pinned, hidden } = req.body || {};
    const values = [];
    const updates = [];
    const addUpdate = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (pinned !== undefined) {
      if (typeof pinned !== 'boolean') return res.status(400).json({ error: 'Некорректное значение pinned' });
      addUpdate('pinned', pinned);
    }
    if (hidden !== undefined) {
      if (typeof hidden !== 'boolean') return res.status(400).json({ error: 'Некорректное значение hidden' });
      addUpdate('hidden', hidden);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Нечего обновлять' });

    values.push(req.params.id);
    await db.query(`UPDATE board_posts SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
    res.json({ ok: true });
  })
);

router.delete(
  '/board/:id',
  asyncHandler(async (req, res) => {
    const removed = await moderation.removeWithLog({
      listingType: 'board',
      listingId: req.params.id,
      actor: `admin:${req.user.id}`,
    });
    if (!removed) return res.status(404).json({ error: 'Объявление не найдено' });
    res.status(204).end();
  })
);

// Жалобы по всем трём видам объявлений. LEFT JOIN, а не JOIN: объявление к
// моменту разбора могло уже пропасть — записка с доски живёт шесть часов, заказ
// удаляет автор. Такая жалоба из списка исчезать не должна, поэтому заголовок
// берём из снимка, снятого при подаче.
router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const onlyOpen = req.query.status !== 'all';
    const { rows } = await db.query(
      `SELECT reports.id, reports.reason, reports.resolved, reports.created_at,
              reports.listing_type, reports.listing_id, reports.snapshot,
              COALESCE(orders.title, vacancies.title, board_posts.text) AS listing_title,
              COALESCE(orders.status, vacancies.status) AS listing_status,
              board_posts.hidden AS board_hidden,
              (orders.id IS NOT NULL OR vacancies.id IS NOT NULL OR board_posts.id IS NOT NULL) AS listing_alive
       FROM reports
       LEFT JOIN orders ON reports.listing_type = 'order' AND orders.id = reports.listing_id
       LEFT JOIN vacancies ON reports.listing_type = 'vacancy' AND vacancies.id = reports.listing_id
       LEFT JOIN board_posts ON reports.listing_type = 'board' AND board_posts.id = reports.listing_id
       ${onlyOpen ? 'WHERE reports.resolved = 0' : ''}
       ORDER BY reports.created_at DESC`
    );
    res.json({ reports: rows });
  })
);

// hide — убрать объявление из выдачи, dismiss — признать жалобу необоснованной.
// В обоих случаях пишем в журнал модерации: важно не только то, что нарушение
// убрали, но и то, что жалобу вообще разобрали и когда.
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

    const actor = `admin:${req.user.id}`;
    const { listing_type: type, listing_id: listingId } = report;

    if (action === 'hide') {
      // Заказ и вакансию закрываем, записку на доске скрываем: удалять нельзя —
      // на объявление есть жалоба, и оно само себе доказательство.
      if (type === 'board') {
        await db.query('UPDATE board_posts SET hidden = TRUE WHERE id = $1', [listingId]);
      } else if (type === 'vacancy') {
        await db.query("UPDATE vacancies SET status = 'closed' WHERE id = $1", [listingId]);
      } else {
        await db.query("UPDATE orders SET status = 'closed' WHERE id = $1", [listingId]);
      }
    }

    await moderation.log({
      listingType: type,
      listingId,
      action: action === 'hide' ? 'hidden' : 'dismissed',
      actor,
      reason: report.reason,
      // Объявления может уже не быть — тогда в журнал уходит снимок из жалобы.
      snapshot: (await moderation.snapshot(type, listingId)) || report.snapshot,
    });
    await db.query('UPDATE reports SET resolved = 1 WHERE id = $1', [report.id]);

    res.json({ ok: true });
  })
);

// Журнал модерации — что и когда сняли с сайта, вместе с текстом объявления.
router.get(
  '/moderation-log',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT id, listing_type, listing_id, action, actor, reason, snapshot, created_at
       FROM moderation_log ORDER BY created_at DESC LIMIT 200`
    );
    res.json({ entries: rows });
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

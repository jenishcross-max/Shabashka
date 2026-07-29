const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../asyncHandler');
const { boardLimiter } = require('../rateLimit');

const router = express.Router();

const MAX_TEXT = 500;
const MIN_TEXT = 10;

// Просроченные записки удаляем перед каждым чтением доски, а не по расписанию:
// на бесплатном тарифе фоновые процессы засыпают вместе с сервисом, а доску
// всё равно никто не смотрит чаще, чем раз в несколько секунд. Пишет строка
// мало и по индексу — дешевле, чем держать отдельный планировщик.
async function sweepExpired() {
  await db.query('DELETE FROM board_posts WHERE expires_at <= NOW()');
}

const POST_FIELDS = `board_posts.id, board_posts.text, board_posts.city, board_posts.whatsapp_phone,
  board_posts.user_id, board_posts.created_at, board_posts.expires_at, users.name AS author_name`;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    await sweepExpired();

    const city = String(req.query.city || '').trim();
    const params = [];
    const where = ['board_posts.expires_at > NOW()'];
    if (city) {
      params.push(`%${city}%`);
      where.push(`board_posts.city ILIKE $${params.length}`);
    }

    const { rows } = await db.query(
      `SELECT ${POST_FIELDS} FROM board_posts JOIN users ON users.id = board_posts.user_id
       WHERE ${where.join(' AND ')} ORDER BY board_posts.created_at DESC LIMIT 100`,
      params
    );
    res.json({ posts: rows });
  })
);

router.post(
  '/',
  requireAuth,
  boardLimiter,
  asyncHandler(async (req, res) => {
    const text = String(req.body?.text || '').trim();
    const city = String(req.body?.city || '').trim();
    const phone = String(req.body?.whatsapp_phone || '').replace(/[^\d+]/g, '');

    if (text.length < MIN_TEXT) return res.status(400).json({ error: 'Напишите хотя бы пару слов о работе' });
    if (text.length > MAX_TEXT) return res.status(400).json({ error: `Слишком длинно — максимум ${MAX_TEXT} символов` });
    if (!city) return res.status(400).json({ error: 'Укажите город' });
    if (phone && phone.length < 9) {
      return res.status(400).json({ error: 'Укажите корректный номер WhatsApp или оставьте поле пустым' });
    }

    // Больше трёх живых записок с одного аккаунта доска не выдержит: она короткая
    // и без фильтров, и один человек в ней виден сразу.
    const { rows: mine } = await db.query(
      'SELECT COUNT(*)::int AS n FROM board_posts WHERE user_id = $1 AND expires_at > NOW()',
      [req.user.id]
    );
    if (mine[0].n >= 3) {
      return res.status(429).json({ error: 'У вас уже три объявления на доске. Дождитесь, пока они пропадут.' });
    }

    const inserted = await db.query(
      `INSERT INTO board_posts (user_id, text, city, whatsapp_phone) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user.id, text, city, phone || null]
    );

    const { rows } = await db.query(
      `SELECT ${POST_FIELDS} FROM board_posts JOIN users ON users.id = board_posts.user_id WHERE board_posts.id = $1`,
      [inserted.rows[0].id]
    );
    res.status(201).json({ post: rows[0] });
  })
);

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Объявление не найдено' });

    const { rows } = await db.query('SELECT user_id FROM board_posts WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Объявление не найдено' });
    if (rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Это не ваше объявление' });
    }

    await db.query('DELETE FROM board_posts WHERE id = $1', [id]);
    res.status(204).end();
  })
);

module.exports = router;

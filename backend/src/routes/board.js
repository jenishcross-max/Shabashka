const express = require('express');
const db = require('../db');
const { optionalAuth } = require('../middleware/auth');
const asyncHandler = require('../asyncHandler');
const { boardLimiter, reportLimiter } = require('../rateLimit');
const reportsRepo = require('../reportsRepo');

const router = express.Router();

const MAX_TEXT = 500;
const MIN_TEXT = 10;
const MAX_LIVE_PER_AUTHOR = 3;

// Просроченные записки удаляем перед каждым чтением доски, а не по расписанию:
// на бесплатном тарифе фоновые процессы засыпают вместе с сервисом, а доску
// всё равно никто не смотрит чаще, чем раз в несколько секунд. Пишет строка
// мало и по индексу — дешевле, чем держать отдельный планировщик.
async function sweepExpired() {
  await db.query('DELETE FROM board_posts WHERE expires_at <= NOW()');
}

const POST_FIELDS = `board_posts.id, board_posts.text, board_posts.city, board_posts.whatsapp_phone,
  board_posts.user_id, board_posts.guest_id, board_posts.created_at, board_posts.expires_at,
  board_posts.pinned, board_posts.is_imported,
  COALESCE(users.name, board_posts.author_name) AS author_name`;

// guest_id наружу не отдаём: это единственное, чем гость подтверждает права на
// своё объявление. Вместо него — готовый ответ на вопрос «моё ли это».
function toPublicPost(row, req) {
  const guestId = String(req.query.guestId || req.body?.guestId || '');
  const mine =
    (req.user && row.user_id === req.user.id) ||
    req.user?.role === 'admin' ||
    (!!row.guest_id && !!guestId && row.guest_id === guestId);
  const { guest_id: _guest, user_id: _user, ...rest } = row;
  return { ...rest, mine: !!mine };
}

router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    await sweepExpired();

    const city = String(req.query.city || '').trim();
    const params = [];
    const where = ['board_posts.expires_at > NOW()', 'board_posts.hidden = FALSE'];
    if (city) {
      params.push(`%${city}%`);
      where.push(`board_posts.city ILIKE $${params.length}`);
    }

    const { rows } = await db.query(
      `SELECT ${POST_FIELDS} FROM board_posts LEFT JOIN users ON users.id = board_posts.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY board_posts.pinned DESC, board_posts.created_at DESC LIMIT 100`,
      params
    );
    res.json({ posts: rows.map((row) => toPublicPost(row, req)) });
  })
);

router.post(
  '/',
  optionalAuth,
  boardLimiter,
  asyncHandler(async (req, res) => {
    const text = String(req.body?.text || '').trim();
    const city = String(req.body?.city || '').trim();
    const phone = String(req.body?.whatsapp_phone || '').replace(/[^\d+]/g, '');
    const guestId = String(req.body?.guestId || '').trim();
    const guestName = String(req.body?.name || '').trim().slice(0, 40);

    if (text.length < MIN_TEXT) return res.status(400).json({ error: 'Напишите хотя бы пару слов о работе' });
    if (text.length > MAX_TEXT) return res.status(400).json({ error: `Слишком длинно — максимум ${MAX_TEXT} символов` });
    if (!city) return res.status(400).json({ error: 'Укажите город' });

    // Гостю номер обязателен: аккаунта у него нет, и написать ему на сайте нельзя —
    // объявление без номера осталось бы просто текстом, на который не откликнуться.
    if (!req.user && !phone) return res.status(400).json({ error: 'Укажите номер WhatsApp — по нему с вами свяжутся' });
    if (phone && phone.replace(/\D/g, '').length < 9) {
      return res.status(400).json({ error: 'Укажите корректный номер WhatsApp' });
    }
    if (!req.user && (guestId.length < 8 || guestId.length > 64)) {
      return res.status(400).json({ error: 'Не удалось определить браузер. Обновите страницу и попробуйте снова.' });
    }

    // Больше трёх живых записок от одного автора доска не выдержит: она короткая
    // и без фильтров, и один человек в ней виден сразу. У гостя считаем по guest_id —
    // обойти это, почистив браузер, можно, но там сверху ещё лимит на адрес.
    const { rows: mine } = await db.query(
      req.user
        ? 'SELECT COUNT(*)::int AS n FROM board_posts WHERE user_id = $1 AND expires_at > NOW()'
        : 'SELECT COUNT(*)::int AS n FROM board_posts WHERE guest_id = $1 AND expires_at > NOW()',
      [req.user ? req.user.id : guestId]
    );
    if (mine[0].n >= MAX_LIVE_PER_AUTHOR) {
      return res
        .status(429)
        .json({ error: 'У вас уже три объявления на доске. Дождитесь, пока они пропадут, или снимите одно.' });
    }

    const inserted = await db.query(
      `INSERT INTO board_posts (user_id, guest_id, author_name, text, city, whatsapp_phone)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        req.user ? req.user.id : null,
        req.user ? null : guestId,
        req.user ? null : guestName || 'Гость',
        text,
        city,
        phone || null,
      ]
    );

    const { rows } = await db.query(
      `SELECT ${POST_FIELDS} FROM board_posts LEFT JOIN users ON users.id = board_posts.user_id
       WHERE board_posts.id = $1`,
      [inserted.rows[0].id]
    );
    res.status(201).json({ post: toPublicPost(rows[0], req) });
  })
);

router.delete(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Объявление не найдено' });

    const { rows } = await db.query('SELECT user_id, guest_id FROM board_posts WHERE id = $1', [id]);
    const post = rows[0];
    if (!post) return res.status(404).json({ error: 'Объявление не найдено' });

    const guestId = String(req.query.guestId || '');
    const owns =
      (req.user && post.user_id === req.user.id) ||
      req.user?.role === 'admin' ||
      (!!post.guest_id && guestId.length >= 8 && post.guest_id === guestId);
    if (!owns) return res.status(403).json({ error: 'Это не ваше объявление' });

    await db.query('DELETE FROM board_posts WHERE id = $1', [id]);
    res.status(204).end();
  })
);

// Пожаловаться на записку с доски. Доска — единственное место на сайте, куда
// пишут без аккаунта и без модерации на входе, так что жалоба здесь нужнее всего.
router.post(
  '/:id/report',
  reportLimiter,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'Объявление не найдено' });

    const { reason } = req.body || {};
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Укажите причину жалобы' });

    const reportId = await reportsRepo.create({ listingType: 'board', listingId: id, reason });
    if (!reportId) return res.status(404).json({ error: 'Объявление не найдено' });
    res.status(201).json({ ok: true });
  })
);

module.exports = router;

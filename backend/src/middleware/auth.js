const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function signToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Недействительный или истёкший токен' });
  }

  try {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [payload.id]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
    if (user.is_blocked) return res.status(403).json({ error: 'Ваш аккаунт заблокирован' });

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// То же самое, но без обязательности: доску читают и пишут без аккаунта, а
// вошедшему всё равно нужно знать, что запись его. Любая проблема с токеном
// здесь не ошибка, а просто «гость».
async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [payload.id]);
    if (rows[0] && !rows[0].is_blocked) req.user = rows[0];
  } catch {
    // истёкший или чужой токен — считаем, что человек не вошёл
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Доступно только администраторам' });
  next();
}

module.exports = { signToken, requireAuth, optionalAuth, requireAdmin, JWT_SECRET };

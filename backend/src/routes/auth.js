const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../rateLimit');
const asyncHandler = require('../asyncHandler');
const { sendVerificationEmail } = require('../mailer');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function verifyLink(token) {
  const base = process.env.PUBLIC_URL || 'http://localhost:5173';
  return `${base}/verify-email?token=${token}`;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    city: user.city,
    role: user.role,
    emailVerified: !!user.email_verified,
  };
}

// Регистрация — только для заказчиков, которые будут размещать заказы
router.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { name, email, phone, password, city } = req.body || {};

    if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите имя' });

    const normalizedEmail = normalizeEmail(email);
    if (!EMAIL_RE.test(normalizedEmail)) return res.status(400).json({ error: 'Укажите корректный email' });

    if (!password || password.length < 8)
      return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' });

    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone.length < 9)
      return res.status(400).json({ error: 'Укажите корректный номер телефона (WhatsApp)' });

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows[0]) return res.status(409).json({ error: 'Пользователь с таким email уже зарегистрирован' });

    const passwordHash = bcrypt.hashSync(password, 10);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);
    const inserted = await db.query(
      `INSERT INTO users (name, email, phone, password_hash, city, email_verified, verify_token, verify_token_expires)
       VALUES ($1, $2, $3, $4, $5, false, $6, $7) RETURNING id`,
      [name.trim(), normalizedEmail, normalizedPhone, passwordHash, city ? city.trim() : null, verifyToken, verifyExpires]
    );

    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [inserted.rows[0].id]);
    const user = rows[0];

    sendVerificationEmail(user.email, user.name, verifyLink(verifyToken)).catch((err) =>
      console.error('Не удалось отправить письмо с подтверждением:', err)
    );

    const token = signToken(user);
    res.status(201).json({ token, user: toPublicUser(user) });
  })
);

router.post(
  '/verify-email',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Не указан код подтверждения' });

    const { rows } = await db.query(
      'SELECT * FROM users WHERE verify_token = $1 AND verify_token_expires > NOW()',
      [token]
    );
    const user = rows[0];
    if (!user) return res.status(400).json({ error: 'Ссылка недействительна или истекла' });

    await db.query(
      'UPDATE users SET email_verified = true, verify_token = NULL, verify_token_expires = NULL WHERE id = $1',
      [user.id]
    );
    user.email_verified = true;
    res.json({ user: toPublicUser(user) });
  })
);

router.post(
  '/resend-verification',
  authLimiter,
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.email_verified) return res.status(400).json({ error: 'Email уже подтверждён' });

    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpires = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);
    await db.query('UPDATE users SET verify_token = $1, verify_token_expires = $2 WHERE id = $3', [
      verifyToken,
      verifyExpires,
      req.user.id,
    ]);

    await sendVerificationEmail(req.user.email, req.user.name, verifyLink(verifyToken));
    res.json({ ok: true });
  })
);

router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    const normalizedEmail = normalizeEmail(email);

    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    if (user.is_blocked) return res.status(403).json({ error: 'Ваш аккаунт заблокирован' });

    const token = signToken(user);
    res.json({ token, user: toPublicUser(user) });
  })
);

// Вход через Google. Ключ клиента публичный, и сайт берёт его отсюда: вторая
// переменная на Netlify не нужна. Пустой GOOGLE_CLIENT_ID — кнопки на сайте нет.
router.get('/google/config', (_req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID || null });
});

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

// Кнопка Google отдаёт сайту подписанный токен. Что он настоящий, не истёк и
// выписан нашему клиенту, проверяет сам Google (tokeninfo) — без своей
// криптографии и новой зависимости. null — Google входа не подтвердил.
async function googleProfile(credential, clientId) {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const info = await res.json();
    const verified = info.email_verified === true || info.email_verified === 'true';
    if (info.aud !== clientId || !GOOGLE_ISSUERS.includes(info.iss) || !verified || !info.email) return null;
    return info;
  } catch {
    return null;
  }
}

// Почту Google уже подтвердил, поэтому аккаунт с ней — тот же человек: входим в
// него. Нет такого — заводим. Пароль случайный: войти можно снова через Google.
// Телефона Google не даёт, его спросит форма объявления.
router.post(
  '/google',
  authLimiter,
  asyncHandler(async (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(404).json({ error: 'Вход через Google не настроен' });
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Google не прислал данных для входа' });

    const profile = await googleProfile(String(credential), clientId);
    if (!profile) return res.status(401).json({ error: 'Google не подтвердил вход. Попробуйте ещё раз' });

    const email = normalizeEmail(profile.email);
    let { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    let user = rows[0];
    if (user && user.is_blocked) return res.status(403).json({ error: 'Ваш аккаунт заблокирован' });

    if (user && !user.email_verified) {
      await db.query(
        'UPDATE users SET email_verified = true, verify_token = NULL, verify_token_expires = NULL WHERE id = $1',
        [user.id]
      );
      user.email_verified = true;
    }
    if (!user) {
      const name = String(profile.name || profile.given_name || email.split('@')[0]).trim().slice(0, 80);
      const passwordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);
      ({ rows } = await db.query(
        `INSERT INTO users (name, email, phone, password_hash, email_verified)
         VALUES ($1, $2, '', $3, true) RETURNING *`,
        [name, email, passwordHash]
      ));
      user = rows[0];
    }

    res.json({ token: signToken(user), user: toPublicUser(user) });
  })
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

module.exports = router;

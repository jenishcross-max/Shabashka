const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  };
}

// Регистрация — только для заказчиков, которые будут размещать заказы
router.post('/register', (req, res) => {
  const { name, email, phone, password, city } = req.body || {};

  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите имя' });

  const normalizedEmail = normalizeEmail(email);
  if (!EMAIL_RE.test(normalizedEmail)) return res.status(400).json({ error: 'Укажите корректный email' });

  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });

  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 9)
    return res.status(400).json({ error: 'Укажите корректный номер телефона (WhatsApp)' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) return res.status(409).json({ error: 'Пользователь с таким email уже зарегистрирован' });

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (name, email, phone, password_hash, city) VALUES (?, ?, ?, ?, ?)')
    .run(name.trim(), normalizedEmail, normalizedPhone, passwordHash, city ? city.trim() : null);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = signToken(user);
  res.status(201).json({ token, user: toPublicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = normalizeEmail(email);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  if (user.is_blocked) return res.status(403).json({ error: 'Ваш аккаунт заблокирован' });

  const token = signToken(user);
  res.json({ token, user: toPublicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user) });
});

module.exports = router;

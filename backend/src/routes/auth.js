const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

function normalizePhone(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}

function toPublicUser(user) {
  return { id: user.id, name: user.name, phone: user.phone, city: user.city };
}

// Регистрация — только для заказчиков, которые будут размещать заказы
router.post('/register', (req, res) => {
  const { name, phone, password, city } = req.body || {};

  if (!name || !name.trim()) return res.status(400).json({ error: 'Укажите имя' });
  if (!password || password.length < 6)
    return res.status(400).json({ error: 'Пароль должен быть не короче 6 символов' });

  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 9)
    return res.status(400).json({ error: 'Укажите корректный номер телефона (WhatsApp)' });

  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(normalizedPhone);
  if (existing) return res.status(409).json({ error: 'Пользователь с таким номером уже зарегистрирован' });

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (name, phone, password_hash, city) VALUES (?, ?, ?, ?)')
    .run(name.trim(), normalizedPhone, passwordHash, city ? city.trim() : null);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = signToken(user);
  res.status(201).json({ token, user: toPublicUser(user) });
});

router.post('/login', (req, res) => {
  const { phone, password } = req.body || {};
  const normalizedPhone = normalizePhone(phone);

  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(normalizedPhone);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Неверный номер телефона или пароль' });
  }

  const token = signToken(user);
  res.json({ token, user: toPublicUser(user) });
});

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ user: toPublicUser(user) });
});

module.exports = router;

// Создаёт (или повышает до admin) пользователя-администратора.
// Использование: node src/createAdmin.js email@example.com пароль "Имя"
const bcrypt = require('bcryptjs');
const db = require('./db');

const [, , email, password, name] = process.argv;

if (!email || !password) {
  console.error('Использование: node src/createAdmin.js email пароль "Имя"');
  process.exit(1);
}

const normalizedEmail = email.trim().toLowerCase();
const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);

if (existing) {
  db.prepare("UPDATE users SET role = 'admin', is_blocked = 0 WHERE id = ?").run(existing.id);
  console.log(`Пользователь ${normalizedEmail} повышен до admin.`);
} else {
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare(
    `INSERT INTO users (name, email, phone, password_hash, city, role)
     VALUES (?, ?, ?, ?, ?, 'admin')`
  ).run(name || 'Администратор', normalizedEmail, '+996700000000', passwordHash, null);
  console.log(`Создан администратор ${normalizedEmail}.`);
}

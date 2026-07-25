// Создаёт (или повышает до admin) пользователя-администратора.
// Использование: node src/createAdmin.js email@example.com пароль "Имя"
const bcrypt = require('bcryptjs');
const db = require('./db');

const [, , email, password, name] = process.argv;

if (!email || !password) {
  console.error('Использование: node src/createAdmin.js email пароль "Имя"');
  process.exit(1);
}

async function main() {
  await db.init();

  const normalizedEmail = email.trim().toLowerCase();
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
  const existing = rows[0];

  if (existing) {
    await db.query("UPDATE users SET role = 'admin', is_blocked = 0 WHERE id = $1", [existing.id]);
    console.log(`Пользователь ${normalizedEmail} повышен до admin.`);
  } else {
    const passwordHash = bcrypt.hashSync(password, 10);
    await db.query(
      `INSERT INTO users (name, email, phone, password_hash, city, role)
       VALUES ($1, $2, $3, $4, $5, 'admin')`,
      [name || 'Администратор', normalizedEmail, '+996700000000', passwordHash, null]
    );
    console.log(`Создан администратор ${normalizedEmail}.`);
  }

  await db.pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

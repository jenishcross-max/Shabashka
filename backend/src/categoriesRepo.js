const db = require('./db');

function listNames() {
  return db.prepare('SELECT name FROM categories ORDER BY id ASC').all().map((r) => r.name);
}

function listAll() {
  return db
    .prepare(
      `SELECT categories.id, categories.name, categories.created_at,
              (SELECT COUNT(*) FROM orders WHERE orders.category = categories.name) AS order_count
       FROM categories
       ORDER BY categories.id ASC`
    )
    .all();
}

function add(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Укажите название категории');
  if (trimmed.length > 40) throw new Error('Название слишком длинное (макс. 40 символов)');

  const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(trimmed);
  if (existing) throw new Error('Такая категория уже есть');

  const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(trimmed);
  return { id: info.lastInsertRowid, name: trimmed };
}

function remove(id) {
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!category) throw new Error('Категория не найдена');

  const ordersUsingIt = db
    .prepare('SELECT COUNT(*) AS n FROM orders WHERE category = ?')
    .get(category.name).n;
  if (ordersUsingIt > 0) {
    throw new Error(`Нельзя удалить: ею помечено ${ordersUsingIt} заказ(ов)`);
  }

  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

module.exports = { listNames, listAll, add, remove };

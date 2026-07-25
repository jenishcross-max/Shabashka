const db = require('./db');

async function listNames({ format } = {}) {
  if (format === 'online' || format === 'offline') {
    const { rows } = await db.query(
      'SELECT name FROM categories WHERE work_formats = $1 OR work_formats = $2 ORDER BY id ASC',
      [format, 'both']
    );
    return rows.map((r) => r.name);
  }
  const { rows } = await db.query('SELECT name FROM categories ORDER BY id ASC');
  return rows.map((r) => r.name);
}

async function listAll() {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.work_formats, c.created_at,
            (SELECT COUNT(*) FROM orders WHERE orders.category = c.name)::int AS order_count
     FROM categories c
     ORDER BY c.id ASC`
  );
  return rows;
}

async function add(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Укажите название категории');
  if (trimmed.length > 40) throw new Error('Название слишком длинное (макс. 40 символов)');

  const existing = await db.query('SELECT id FROM categories WHERE name = $1', [trimmed]);
  if (existing.rows[0]) throw new Error('Такая категория уже есть');

  const inserted = await db.query('INSERT INTO categories (name) VALUES ($1) RETURNING id', [trimmed]);
  return { id: inserted.rows[0].id, name: trimmed };
}

async function remove(id) {
  const category = await db.query('SELECT * FROM categories WHERE id = $1', [id]);
  if (!category.rows[0]) throw new Error('Категория не найдена');

  const count = await db.query('SELECT COUNT(*)::int AS n FROM orders WHERE category = $1', [
    category.rows[0].name,
  ]);
  if (count.rows[0].n > 0) {
    throw new Error(`Нельзя удалить: ею помечено ${count.rows[0].n} заказ(ов)`);
  }

  await db.query('DELETE FROM categories WHERE id = $1', [id]);
}

module.exports = { listNames, listAll, add, remove };

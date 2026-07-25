const db = require('./db');
const { cached, invalidate } = require('./cache');

const LIST_TTL = 5 * 60 * 1000;

// Список категорий читается почти на каждой странице и при проверке каждого
// объявления, а меняется только руками администратора — держим его в памяти
// и сбрасываем при добавлении/удалении.
async function listNames({ format } = {}) {
  const scope = format === 'online' || format === 'offline' ? format : 'all';
  return cached(`categories:names:${scope}`, LIST_TTL, async () => {
    if (scope !== 'all') {
      const { rows } = await db.query(
        'SELECT name FROM categories WHERE work_formats = $1 OR work_formats = $2 ORDER BY id ASC',
        [scope, 'both']
      );
      return rows.map((r) => r.name);
    }
    const { rows } = await db.query('SELECT name FROM categories ORDER BY id ASC');
    return rows.map((r) => r.name);
  });
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
  invalidate('categories:');
  invalidate('home:');
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
  invalidate('categories:');
  invalidate('home:');
}

module.exports = { listNames, listAll, add, remove };

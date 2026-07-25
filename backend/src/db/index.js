const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'DATABASE_URL не задан. Укажите строку подключения к Postgres (Neon/Supabase) в backend/.env'
  );
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString || '');

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

let readyPromise = null;

async function tagCategories(names, format) {
  if (names.length === 0) return;
  const placeholders = names.map((_, i) => `$${i + 2}`).join(',');
  await pool.query(`UPDATE categories SET work_formats = $1 WHERE name IN (${placeholders})`, [format, ...names]);
}

function init() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      await pool.query(schema);

      // Аддитивная миграция для баз, созданных до появления этих колонок
      await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS work_format TEXT NOT NULL DEFAULT 'offline'");
      await pool.query("ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS work_format TEXT NOT NULL DEFAULT 'offline'");
      await pool.query("ALTER TABLE categories ADD COLUMN IF NOT EXISTS work_formats TEXT NOT NULL DEFAULT 'both'");

      // Первичное заполнение категорий — дальше список живёт в БД и правится через админку
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM categories');
      if (rows[0].n === 0) {
        const defaultCategories = require('../defaultCategories');
        for (const name of defaultCategories) {
          await pool.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
        }
      }

      // Разметка формата работы для существующих категорий: физические работы — только офлайн
      // ("Репетиторы" и "Другое" оставляем 'both' — по умолчанию, подходят под оба формата)
      const offlineOnlyCategories = ['Ремонт', 'Уборка', 'Грузоперевозки', 'Красота', 'Электрика', 'Сантехника', 'Сад и огород'];
      await tagCategories(offlineOnlyCategories, 'offline');

      // Новые категории для удалённой работы
      const onlineCategories = require('../onlineCategories');
      for (const name of onlineCategories) {
        await pool.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
      }
      await tagCategories(onlineCategories, 'online');
    })();
  }
  return readyPromise;
}

module.exports = {
  pool,
  init,
  query: (text, params) => pool.query(text, params),
};

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

function init() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      await pool.query(schema);

      // Первичное заполнение категорий — дальше список живёт в БД и правится через админку
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM categories');
      if (rows[0].n === 0) {
        const defaultCategories = require('../defaultCategories');
        for (const name of defaultCategories) {
          await pool.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
        }
      }
    })();
  }
  return readyPromise;
}

module.exports = {
  pool,
  init,
  query: (text, params) => pool.query(text, params),
};

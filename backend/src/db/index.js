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
  // max рассчитан на нагрузку в сотни одновременных запросов на один backend-процесс;
  // держим значение ниже лимита пулера Supabase (Supavisor), чтобы не упереться в него
  // при нескольких инстансах backend одновременно.
  max: 20,
  idleTimeoutMillis: 30 * 1000,
  connectionTimeoutMillis: 15 * 1000,
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
      await pool.query("ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS experience TEXT NOT NULL DEFAULT 'no_experience'");
      await pool.query('ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS requirements TEXT');
      await pool.query('ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS conditions TEXT');

      // Номер WhatsApp теперь необязателен — можно ограничиться перепиской на сайте
      await pool.query('ALTER TABLE orders ALTER COLUMN whatsapp_phone DROP NOT NULL');
      await pool.query('ALTER TABLE vacancies ALTER COLUMN whatsapp_phone DROP NOT NULL');

      // conversations раньше была привязана только к вакансиям (vacancy_id NOT NULL).
      // Обобщаем на заказы через полиморфную пару listing_type/listing_id;
      // на уже развёрнутых базах старая колонка есть — доращиваем её аддитивно,
      // на свежих (schema.sql уже создал финальную форму) этой ветки не будет.
      const { rows: legacyCol } = await pool.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name = 'conversations' AND column_name = 'vacancy_id'"
      );
      if (legacyCol.length > 0) {
        await pool.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS listing_type TEXT NOT NULL DEFAULT 'vacancy'");
        await pool.query('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS listing_id INTEGER');
        await pool.query('UPDATE conversations SET listing_id = vacancy_id WHERE listing_id IS NULL');
        await pool.query('ALTER TABLE conversations ALTER COLUMN vacancy_id DROP NOT NULL');
        const { rows: unbackfilled } = await pool.query('SELECT COUNT(*)::int AS n FROM conversations WHERE listing_id IS NULL');
        if (unbackfilled[0].n === 0) {
          await pool.query('ALTER TABLE conversations ALTER COLUMN listing_id SET NOT NULL');
        }
      }
      await pool.query('CREATE INDEX IF NOT EXISTS idx_conversations_listing ON conversations(listing_type, listing_id)');
      await pool.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_listing_seeker ON conversations(listing_type, listing_id, seeker_id)'
      );

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

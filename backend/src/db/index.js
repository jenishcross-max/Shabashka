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

      // Подтверждение email — старые пользователи считаются подтверждёнными по умолчанию,
      // новые регистрации явно проставляют email_verified = false и токен в коде роута.
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT true');
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token TEXT');
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token_expires TIMESTAMPTZ');

      // Отмечает витринные объявления-примеры (см. seedExamples.js) — отдельно от
      // настоящих объявлений пользователей, чтобы честно показывать это в интерфейсе
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_example BOOLEAN NOT NULL DEFAULT false');
      await pool.query('ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS is_example BOOLEAN NOT NULL DEFAULT false');

      // «Поднять» объявление в списке — раз в 24 часа для автора, без ограничений из админки
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS bumped_at TIMESTAMPTZ');
      await pool.query('ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS bumped_at TIMESTAMPTZ');

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
      // Импорт вакансий через Telegram-бота добавили позже импорта заказов —
      // доращиваем колонку на уже развёрнутых базах.
      await pool.query('ALTER TABLE imported_listings ADD COLUMN IF NOT EXISTS vacancy_id INTEGER REFERENCES vacancies(id) ON DELETE SET NULL');

      // Счётчик «сколько опубликовано сегодня» считается по времени публикации,
      // а не создания записи: раньше между ними был человек с кнопкой, и разница
      // доходила до суток. У старых строк время публикации уже не восстановить —
      // берём created_at, для них это ближайшая правда.
      await pool.query('ALTER TABLE imported_listings ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ');
      await pool.query("UPDATE imported_listings SET published_at = created_at WHERE status = 'published' AND published_at IS NULL");

      // Доска сначала была только для зарегистрированных — доращиваем её до гостей
      await pool.query('ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS guest_id TEXT');
      await pool.query('ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS author_name TEXT');
      await pool.query('ALTER TABLE board_posts ALTER COLUMN user_id DROP NOT NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_board_posts_guest ON board_posts(guest_id)');

      // Бот публикует на доску то, что не заказ и не вакансия (продажа, аренда,
      // свои услуги). Ссылку на записку держим без REFERENCES: доска чистит себя
      // сама, и внешний ключ пришлось бы дублировать каскадом ради строки, которая
      // и так живёт шесть часов.
      await pool.query('ALTER TABLE imported_listings ADD COLUMN IF NOT EXISTS board_post_id INTEGER');

      // Модерация доски: закрепить объявление или скрыть его без удаления
      await pool.query('ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE');
      await pool.query('ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE');

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

      // Объявления, которые бот взял из чужих чатов. Помечаем их в самой карточке:
      // автора такого объявления никто не проверял и он о публикации не просил,
      // и выдавать его за проверенное — единственное, чем площадка реально
      // рискует. См. telegram/imports.js.
      await pool.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT false');
      await pool.query('ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT false');
      await pool.query('ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT false');

      // Задним числом помечаем то, что уже опубликовал бот: связи в
      // imported_listings для этого есть, а без разметки старые объявления
      // выглядели бы как поданные вручную.
      await pool.query(
        `UPDATE orders SET is_imported = true WHERE id IN
           (SELECT order_id FROM imported_listings WHERE order_id IS NOT NULL)`
      );
      await pool.query(
        `UPDATE vacancies SET is_imported = true WHERE id IN
           (SELECT vacancy_id FROM imported_listings WHERE vacancy_id IS NOT NULL)`
      );
      await pool.query(
        `UPDATE board_posts SET is_imported = true WHERE id IN
           (SELECT board_post_id FROM imported_listings WHERE board_post_id IS NOT NULL)`
      );

      // Жалобы были только на заказы (reports.order_id с каскадным удалением).
      // Обобщаем на вакансии и доску через полиморфную пару listing_type/listing_id
      // и снимаем каскад: жалоба должна пережить удаление объявления, иначе после
      // «скрыть» не остаётся доказательства, что нарушение вообще разбирали.
      await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS listing_type TEXT NOT NULL DEFAULT 'order'");
      await pool.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS listing_id INTEGER');
      await pool.query('ALTER TABLE reports ADD COLUMN IF NOT EXISTS snapshot JSONB');
      const { rows: legacyReports } = await pool.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name = 'reports' AND column_name = 'order_id'"
      );
      if (legacyReports.length > 0) {
        await pool.query('UPDATE reports SET listing_id = order_id WHERE listing_id IS NULL');
        // Колонку убираем целиком: вместе с ней уходит внешний ключ с ON DELETE
        // CASCADE, из-за которого жалобы исчезали вслед за заказом.
        await pool.query('ALTER TABLE reports DROP COLUMN order_id');
      }
      // Строки без listing_id остаться не должны, но если такие есть (жалоба на
      // заказ, удалённый ещё каскадом), NOT NULL их не пропустит — тогда просто
      // оставляем колонку как есть, читать журнал это не мешает.
      const { rows: orphanReports } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM reports WHERE listing_id IS NULL'
      );
      if (orphanReports[0].n === 0) {
        await pool.query('ALTER TABLE reports ALTER COLUMN listing_id SET NOT NULL');
      }
      await pool.query('DROP INDEX IF EXISTS idx_reports_order');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_reports_listing ON reports(listing_type, listing_id)');

      // Лимит на повтор объявления был вечным (уникальный индекс) — теперь это
      // окно в час, которое считается в коде (см. telegram/imports.js), так
      // что сам индекс на дубли-в-базе больше не годится и его снимаем.
      await pool.query('DROP INDEX IF EXISTS idx_imported_dedup');
      await pool.query(
        'CREATE INDEX IF NOT EXISTS idx_imported_dedup ON imported_listings(dedup_hash) WHERE dedup_hash IS NOT NULL'
      );
    })();
  }
  return readyPromise;
}

module.exports = {
  pool,
  init,
  query: (text, params) => pool.query(text, params),
};

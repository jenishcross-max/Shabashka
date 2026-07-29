-- Шабашка — схема базы данных (PostgreSQL: Neon / Supabase)

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  city          TEXT,
  role          TEXT NOT NULL DEFAULT 'customer', -- customer | admin
  is_blocked    INTEGER NOT NULL DEFAULT 0,
  email_verified BOOLEAN NOT NULL DEFAULT true,
  verify_token  TEXT,
  verify_token_expires TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL,
  category       TEXT NOT NULL,
  city           TEXT NOT NULL,
  address        TEXT, -- примерный адрес/район — без точного адреса и подъезда
  work_format    TEXT NOT NULL DEFAULT 'offline', -- online | offline
  budget         INTEGER,
  whatsapp_phone TEXT, -- необязателен: можно вести переписку только на сайте
  status         TEXT NOT NULL DEFAULT 'open', -- open | closed
  views          INTEGER NOT NULL DEFAULT 0,
  pinned         INTEGER NOT NULL DEFAULT 0,
  bumped_at      TIMESTAMPTZ, -- когда объявление последний раз подняли в списке (см. /bump)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_category ON orders(category);
CREATE INDEX IF NOT EXISTS idx_orders_city ON orders(city);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

CREATE TABLE IF NOT EXISTS reports (
  id         SERIAL PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL,
  resolved   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_order ON reports(order_id);

CREATE TABLE IF NOT EXISTS categories (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  work_formats  TEXT NOT NULL DEFAULT 'both', -- online | offline | both
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vacancies (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  category        TEXT NOT NULL,
  employment_type TEXT NOT NULL, -- full_time | part_time | shift | gig | internship
  city            TEXT NOT NULL,
  address         TEXT,
  work_format     TEXT NOT NULL DEFAULT 'offline', -- online | offline
  experience      TEXT NOT NULL DEFAULT 'no_experience', -- no_experience | 1-3 | 3-6 | 6+
  requirements    TEXT, -- требования к кандидату
  conditions      TEXT, -- условия работы
  salary_min      INTEGER,
  salary_max      INTEGER,
  schedule        TEXT, -- например «Пн–Пт, 9:00–18:00»
  whatsapp_phone  TEXT, -- необязателен: можно вести переписку только на сайте
  status          TEXT NOT NULL DEFAULT 'open', -- open | closed
  views           INTEGER NOT NULL DEFAULT 0,
  pinned          INTEGER NOT NULL DEFAULT 0,
  bumped_at       TIMESTAMPTZ, -- когда вакансию последний раз подняли в списке (см. /bump)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Переписка по объявлению (заказу или вакансии) между тем, кто его разместил,
-- и тем, кто откликается. listing_type/listing_id — полиморфная ссылка (на
-- orders или vacancies), поэтому здесь нет FK на конкретную таблицу — целостность
-- проверяется в коде роута. Одна ветка на пару (объявление, автор отклика).
CREATE TABLE IF NOT EXISTS conversations (
  id              SERIAL PRIMARY KEY,
  listing_type    TEXT NOT NULL, -- order | vacancy
  listing_id      INTEGER NOT NULL,
  seeker_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- автор отклика
  employer_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- автор объявления
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (listing_type, listing_id, seeker_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_seeker ON conversations(seeker_id);
CREATE INDEX IF NOT EXISTS idx_conversations_employer ON conversations(employer_id);
-- idx_conversations_listing создаётся в db/index.js после миграции — на уже
-- развёрнутых базах колонки listing_type/listing_id появляются только там,
-- а этот файл выполняется целиком до миграции.

CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  read_at         TIMESTAMPTZ, -- NULL = получатель ещё не открывал ветку
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_vacancies_category ON vacancies(category);
CREATE INDEX IF NOT EXISTS idx_vacancies_city ON vacancies(city);
CREATE INDEX IF NOT EXISTS idx_vacancies_user ON vacancies(user_id);

-- Объявления, вытащенные ботом из скриншотов и пересланных сообщений (WhatsApp,
-- Telegram). Сюда они попадают в статусе pending и ждут, пока администратор
-- нажмёт «Опубликовать» — автопубликация чужого текста слишком дорого обходится
-- по качеству и по чужим персональным данным. parsed — разбор Claude в JSON.
CREATE TABLE IF NOT EXISTS imported_listings (
  id            SERIAL PRIMARY KEY,
  source        TEXT NOT NULL DEFAULT 'telegram', -- откуда пришло: whatsapp | telegram
  raw_text      TEXT,        -- исходный текст, если пересылали сообщение
  parsed        JSONB,       -- разбор в поля заказа (см. telegram/extract.js)
  dedup_hash    TEXT,        -- одно объявление постят в несколько чатов — режем повторы
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | published | rejected
  order_id      INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  vacancy_id    INTEGER REFERENCES vacancies(id) ON DELETE SET NULL,
  tg_chat_id    BIGINT,      -- чат и сообщение с карточкой — чтобы обновить её после решения
  tg_message_id BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at  TIMESTAMPTZ  -- когда ушло на сайт; по нему считается счётчик за день
);

-- «Доска» — быстрые объявления, которые живут шесть часов и пропадают сами.
-- Отдельная таблица, а не флаг в orders: у заказа есть категория, бюджет,
-- переписка, статус и жизнь в поиске, а здесь всё это лишнее — записка на
-- доске нужна ровно до конца смены. Срок хранится в expires_at, а не считается
-- от created_at в запросах: так его видно в самой строке и его можно продлить,
-- не трогая время публикации.
-- Писать на доску можно и без аккаунта: регистрация ради записки, которая живёт
-- шесть часов, отпугивает больше, чем спасает. У гостя вместо user_id — guest_id,
-- случайная строка из его браузера: по ней считается лимит и по ней же он снимает
-- своё объявление. Это не защита от подмены, а удобство — цена вопроса тут
-- объявление на полдня, а не доступ к аккаунту.
CREATE TABLE IF NOT EXISTS board_posts (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER REFERENCES users(id) ON DELETE CASCADE, -- NULL у гостей
  guest_id       TEXT,   -- заполнен, только если объявление повесил гость
  author_name    TEXT,   -- имя гостя; у зарегистрированных берём из users
  text           TEXT NOT NULL,
  city           TEXT NOT NULL,
  whatsapp_phone TEXT, -- у гостя обязателен: связаться с ним больше нечем
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '6 hours'
);

CREATE INDEX IF NOT EXISTS idx_board_posts_guest ON board_posts(guest_id);

CREATE INDEX IF NOT EXISTS idx_board_posts_expires ON board_posts(expires_at);
CREATE INDEX IF NOT EXISTS idx_board_posts_user ON board_posts(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_imported_dedup
  ON imported_listings(dedup_hash) WHERE dedup_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_imported_status ON imported_listings(status);

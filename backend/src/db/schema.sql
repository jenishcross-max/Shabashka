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

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
  whatsapp_phone TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open', -- open | closed
  views          INTEGER NOT NULL DEFAULT 0,
  pinned         INTEGER NOT NULL DEFAULT 0,
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
  salary_min      INTEGER,
  salary_max      INTEGER,
  schedule        TEXT, -- например «Пн–Пт, 9:00–18:00»
  whatsapp_phone  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open', -- open | closed
  views           INTEGER NOT NULL DEFAULT 0,
  pinned          INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vacancies_category ON vacancies(category);
CREATE INDEX IF NOT EXISTS idx_vacancies_city ON vacancies(city);
CREATE INDEX IF NOT EXISTS idx_vacancies_user ON vacancies(user_id);

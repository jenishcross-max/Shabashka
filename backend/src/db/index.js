const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'shabashka.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Дев-миграция: старые базы без email — пересоздаём таблицы под новую схему
const usersColumns = db.prepare("PRAGMA table_info(users)").all();
const hasEmail = usersColumns.some((c) => c.name === 'email');
if (!hasEmail) {
  db.exec('DROP TABLE IF EXISTS reports; DROP TABLE IF EXISTS orders; DROP TABLE IF EXISTS users;');
  db.exec(schema);
}

module.exports = db;

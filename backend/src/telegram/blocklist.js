const db = require('../db');
const { phonesIn } = require('../phone');

// Номера, с которых в группы шлют мусор.
//
// Сетевой найм в группах пишут одни и те же люди, каждый день новыми словами:
// сегодня «помощник администратора», завтра «оператор в офис», послезавтра
// «работа для студентов». Слова фильтр (см. spam.js) ловит не все, а номер у
// вербовщика один. Поэтому номер, на котором фильтр поймал мусор, бот
// запоминает, и посты с ним из групп дальше не разбирает вовсе — ни слов, ни
// модели. Кнопка «🚫 Спам» под объявлением делает то же руками.
//
// Не навсегда: номер мог достаться другому человеку, а фильтр — ошибиться.
// Касается только постов из групп; присланное админом проходит всегда.

const DEFAULT_DAYS = 30;
// Список целиком держим в памяти: постов из групп под сотню в час, и ходить за
// каждым в базу незачем. Перечитываем раз в несколько минут — кнопка у одного
// админа должна сработать и у второго.
const REFRESH_MS = 5 * 60 * 1000;

let cache = new Set();
let loadedAt = 0;

async function load() {
  const { rows } = await db.query('SELECT phone FROM blocked_phones WHERE expires_at > NOW()');
  cache = new Set(rows.map((row) => row.phone));
  loadedAt = Date.now();
}

// Есть ли в тексте номер из списка. Возвращает сам номер — для лога.
async function blockedIn(text) {
  if (Date.now() - loadedAt > REFRESH_MS) {
    await load().catch((err) => console.error('[чёрный список] не прочитать:', err.message));
  }
  return phonesIn(text).find((phone) => cache.has(phone)) || null;
}

// Запомнить номера. Срок продлевается, если номер уже был в списке.
async function add(phones, reason, days = DEFAULT_DAYS) {
  const list = [...new Set((phones || []).filter(Boolean))];
  for (const phone of list) {
    await db.query(
      `INSERT INTO blocked_phones (phone, reason, expires_at)
       VALUES ($1, $2, NOW() + ($3 || ' days')::interval)
       ON CONFLICT (phone) DO UPDATE SET reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at`,
      [phone, String(reason || '').slice(0, 300), String(days)]
    );
    cache.add(phone);
  }
  return list.length;
}

// Убрать номера из списка — кнопка «✅ Не спам» в /spam.
async function remove(phones) {
  const list = [...new Set((phones || []).filter(Boolean))];
  if (!list.length) return 0;
  await db.query('DELETE FROM blocked_phones WHERE phone = ANY($1)', [list]);
  for (const phone of list) cache.delete(phone);
  return list.length;
}

async function size() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM blocked_phones WHERE expires_at > NOW()');
  return rows[0].n;
}

module.exports = { phonesIn, blockedIn, add, remove, size, DEFAULT_DAYS };

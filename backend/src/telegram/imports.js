const crypto = require('crypto');
const db = require('../db');
const categoriesRepo = require('../categoriesRepo');
const { invalidate } = require('../cache');

// Одно объявление автор рассылает сразу в несколько чатов, и скриншоты приходят
// пачкой. Ключ повтора — телефон плюс сжатый заголовок: у одного и того же
// заказа они совпадут, даже если скриншот сделан из другого чата.
function dedupHash(parsed) {
  const key = [
    parsed.phone || '',
    String(parsed.title || '')
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, ''),
  ].join('|');
  if (key === '|') return null;
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Возвращает null, если такое объявление уже приходило.
async function create({ source, rawText, parsed, chatId }) {
  const hash = dedupHash(parsed);
  const { rows } = await db.query(
    `INSERT INTO imported_listings (source, raw_text, parsed, dedup_hash, tg_chat_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (dedup_hash) WHERE dedup_hash IS NOT NULL DO NOTHING
     RETURNING id`,
    [source, rawText || null, parsed, hash, chatId]
  );
  return rows[0] ? rows[0].id : null;
}

async function get(id) {
  const { rows } = await db.query('SELECT * FROM imported_listings WHERE id = $1', [id]);
  return rows[0] || null;
}

async function setParsed(id, parsed) {
  await db.query('UPDATE imported_listings SET parsed = $1 WHERE id = $2', [parsed, id]);
}

async function setCard(id, chatId, messageId) {
  await db.query('UPDATE imported_listings SET tg_chat_id = $1, tg_message_id = $2 WHERE id = $3', [
    chatId,
    messageId,
    id,
  ]);
}

async function reject(id) {
  await db.query("UPDATE imported_listings SET status = 'rejected' WHERE id = $1", [id]);
}

// Аккаунт, от имени которого публикуются импортированные объявления. Берём
// администратора: у него подтверждён email, поэтому лимит на одно объявление
// без подтверждения (см. emailGate.js) импорта не касается.
let ownerIdPromise = null;
function resolveOwnerId() {
  if (!ownerIdPromise) {
    ownerIdPromise = (async () => {
      const email = process.env.BOT_OWNER_EMAIL;
      if (email) {
        const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [email]);
        if (rows[0]) return rows[0].id;
        throw new Error(`BOT_OWNER_EMAIL=${email}: такого пользователя нет`);
      }
      const { rows } = await db.query(
        "SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1"
      );
      if (!rows[0]) throw new Error('Нет администратора — задайте BOT_OWNER_EMAIL');
      return rows[0].id;
    })().catch((err) => {
      ownerIdPromise = null; // не кэшируем неудачу — следующая попытка начнёт заново
      throw err;
    });
  }
  return ownerIdPromise;
}

// Чего не хватает, чтобы объявление можно было опубликовать.
async function validate(parsed) {
  const errors = [];
  if (!parsed.title) errors.push('нет заголовка');
  if (!parsed.description) errors.push('нет описания');
  if (!parsed.city) errors.push('не указан город');

  const known = await categoriesRepo.listNames();
  if (!known.includes(parsed.category)) errors.push('категория не из списка');

  return errors;
}

async function publish(id) {
  const row = await get(id);
  if (!row) throw new Error('Объявление не найдено');
  if (row.status === 'published') throw new Error('Уже опубликовано');

  const parsed = row.parsed;
  const errors = await validate(parsed);
  if (errors.length) throw new Error(`Не хватает данных: ${errors.join(', ')}`);

  const userId = await resolveOwnerId();

  if (parsed.listing_type === 'vacancy') {
    const inserted = await db.query(
      `INSERT INTO vacancies
        (user_id, title, description, category, employment_type, city, address, work_format, experience, salary_min, whatsapp_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        userId,
        parsed.title,
        parsed.description,
        parsed.category,
        parsed.employment_type,
        parsed.city,
        parsed.address,
        parsed.work_format,
        parsed.experience,
        parsed.budget,
        parsed.phone,
      ]
    );
    const vacancyId = inserted.rows[0].id;

    await db.query("UPDATE imported_listings SET status = 'published', vacancy_id = $1 WHERE id = $2", [
      vacancyId,
      id,
    ]);
    invalidate('home:');

    return { type: 'vacancy', id: vacancyId };
  }

  const inserted = await db.query(
    `INSERT INTO orders (user_id, title, description, category, city, address, work_format, budget, whatsapp_phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      userId,
      parsed.title,
      parsed.description,
      parsed.category,
      parsed.city,
      parsed.address,
      parsed.work_format,
      parsed.budget,
      parsed.phone,
    ]
  );
  const orderId = inserted.rows[0].id;

  await db.query("UPDATE imported_listings SET status = 'published', order_id = $1 WHERE id = $2", [
    orderId,
    id,
  ]);
  invalidate('home:'); // чтобы объявление сразу попало в ленту на главной

  return { type: 'order', id: orderId };
}

module.exports = { create, get, setParsed, setCard, reject, publish, validate };

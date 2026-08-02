const crypto = require('crypto');
const db = require('../db');
const categoriesRepo = require('../categoriesRepo');
const { invalidate } = require('../cache');
const moderation = require('../moderation');
const { money } = require('../money');

// Одно объявление автор рассылает сразу в несколько чатов, и скриншоты приходят
// пачкой. Ключ повтора — телефон плюс сжатый заголовок: у одного и того же
// заказа они совпадут, даже если скриншот сделан из другого чата.
// У доски своего лимита нет — туда постят продажу, аренду и разовые услуги,
// и то же самое объявление там нормально повесить снова хоть на следующий день.
function dedupHash(parsed) {
  if (parsed.listing_type === 'board') return null;
  const key = [
    parsed.phone || '',
    String(parsed.title || '')
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, ''),
  ].join('|');
  if (key === '|') return null;
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Окно повтора — час. Смысл проверки остался ровно один: поймать пачку, где то
// же объявление попало сразу в несколько скриншотов из разных чатов — иначе на
// сайте окажутся три одинаковые карточки, три поста в канале и три ролика, а
// заодно втрое сгорит часовой лимит Meta. Всё, что старше часа, — это уже не
// дубль, а осознанная повторная публикация: объявления живут долго, их поднимают
// и постят заново, и мешать этому нечем.
const DEDUP_WINDOW = '1 hour';

// Возвращает null, если такое объявление уже приходило в последний час.
async function create({ source, rawText, parsed, chatId }) {
  const hash = dedupHash(parsed);
  if (hash) {
    const { rows: dup } = await db.query(
      `SELECT 1 FROM imported_listings
       WHERE dedup_hash = $1 AND created_at > NOW() - INTERVAL '${DEDUP_WINDOW}'
       LIMIT 1`,
      [hash]
    );
    if (dup.length) return null;
  }
  const { rows } = await db.query(
    `INSERT INTO imported_listings (source, raw_text, parsed, dedup_hash, tg_chat_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [source, rawText || null, parsed, hash, chatId]
  );
  return rows[0].id;
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

// Город по умолчанию: бот разбирает чаты Бишкека, и объявление без города
// почти всегда бишкекское. Ошибиться тут дешевле, чем не опубликовать вовсе.
const FALLBACK_CITY = 'Бишкек';
const FALLBACK_CATEGORY = 'Другое';

// Первая фраза описания как заголовок — обрезаем по границе слова, чтобы
// не получить «Нужен сантехник поменять смеси».
function titleFrom(description) {
  const first = String(description).split(/[.!?\n]/)[0].trim();
  if (first.length <= 70) return first;
  return `${first.slice(0, 70).replace(/\s+\S*$/, '')}…`;
}

// Достраивает объявление до публикуемого вида. Публикация идёт без подтверждения,
// спросить недостающее не у кого — поэтому пустые поля не повод остановиться,
// а повод подставить осмысленное значение. Возвращает { parsed, filled }:
// filled — список того, что дописали, чтобы это было видно в отчёте, а не молча.
async function applyDefaults(parsed) {
  const out = { ...parsed };
  const filled = [];

  if (!out.city) {
    out.city = FALLBACK_CITY;
    filled.push('город');
  }

  const known = await categoriesRepo.listNames();
  if (!known.includes(out.category)) {
    out.category = known.includes(FALLBACK_CATEGORY) ? FALLBACK_CATEGORY : known[0];
    filled.push('категория');
  }

  if (!out.title && out.description) {
    out.title = titleFrom(out.description);
    filled.push('заголовок');
  }
  if (!out.description && out.title) {
    out.description = out.title;
    filled.push('описание');
  }

  // Ни заголовка, ни описания — публиковать нечего, но и это не тупик:
  // категория с городом уже дают осмысленную строку.
  if (!out.title) {
    const kind =
      out.listing_type === 'vacancy' ? 'Вакансия' : out.listing_type === 'board' ? 'Объявление' : 'Заказ';
    out.title = `${kind}: ${out.category}`;
    out.description = `${out.title}. Подробности по телефону.`;
    filled.push('заголовок', 'описание');
  }

  return { parsed: out, filled };
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

// Доска — это одна записка текстом: ни заголовка, ни категории, ни поля с ценой
// там нет, поэтому собираем всё в один абзац. Лимит тот же, что у формы на сайте
// (500 символов): записка на доске должна читаться целиком, не разворачиваясь.
const BOARD_MAX_TEXT = 500;

function boardText(parsed) {
  const parts = [];
  if (parsed.title) parts.push(parsed.title);
  // Описание модель часто дублирует заголовком — второй раз то же самое не нужно
  if (parsed.description && parsed.description !== parsed.title) parts.push(parsed.description);
  if (parsed.budget) parts.push(`💰 ${money(parsed.budget)} сом`);

  const text = parts.join('\n');
  if (text.length <= BOARD_MAX_TEXT) return text;
  return `${text.slice(0, BOARD_MAX_TEXT - 1).replace(/\s+\S*$/, '')}…`;
}

async function publish(id) {
  const row = await get(id);
  if (!row) throw new Error('Объявление не найдено');
  if (row.status === 'published') throw new Error('Уже опубликовано');

  const parsed = row.parsed;
  const errors = await validate(parsed);
  if (errors.length) throw new Error(`Не хватает данных: ${errors.join(', ')}`);

  const userId = await resolveOwnerId();

  // Не заказ и не вакансия (продают дом, сдают квартиру, предлагают свои услуги) —
  // такому на сайте карточки нет, но и терять его незачем: место такому объявлению
  // на доске, где оно живёт сутки рядом с остальной срочной мелочью.
  if (parsed.listing_type === 'board') {
    const inserted = await db.query(
      `INSERT INTO board_posts (user_id, text, city, whatsapp_phone, is_imported)
       VALUES ($1, $2, $3, $4, true) RETURNING id`,
      [userId, boardText(parsed), parsed.city, parsed.phone]
    );
    const postId = inserted.rows[0].id;

    await db.query(
      "UPDATE imported_listings SET status = 'published', published_at = NOW(), board_post_id = $1 WHERE id = $2",
      [postId, id]
    );

    return { type: 'board', id: postId };
  }

  if (parsed.listing_type === 'vacancy') {
    const inserted = await db.query(
      `INSERT INTO vacancies
        (user_id, title, description, category, employment_type, city, address, work_format, experience, salary_min, whatsapp_phone, is_imported)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true) RETURNING id`,
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

    await db.query(
      "UPDATE imported_listings SET status = 'published', published_at = NOW(), vacancy_id = $1 WHERE id = $2",
      [vacancyId, id]
    );
    invalidate('home:');

    return { type: 'vacancy', id: vacancyId };
  }

  const inserted = await db.query(
    `INSERT INTO orders (user_id, title, description, category, city, address, work_format, budget, whatsapp_phone, is_imported)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true) RETURNING id`,
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

  await db.query(
    "UPDATE imported_listings SET status = 'published', published_at = NOW(), order_id = $1 WHERE id = $2",
    [orderId, id]
  );
  invalidate('home:'); // чтобы объявление сразу попало в ленту на главной

  return { type: 'order', id: orderId };
}

// Сколько объявлений ушло на сайт сегодня. День считаем по Бишкеку, а не по UTC:
// сервер живёт в UTC, и после полуночи по местному времени счётчик ещё шесть
// часов показывал бы вчерашний итог.
async function countToday() {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM imported_listings
      WHERE status = 'published'
        AND (published_at AT TIME ZONE 'Asia/Bishkek')::date = (NOW() AT TIME ZONE 'Asia/Bishkek')::date`
  );
  return rows[0].n;
}

// Снять уже опубликованное объявление с сайта. Подтверждения перед публикацией
// больше нет, поэтому убрать лишнее нужно уметь после неё — иначе чужой телефон
// останется в ленте навсегда.
// Удаляем со снимком в журнал модерации: чаще всего кнопку жмут именно потому,
// что в разбор попало лишнее — чужая переписка, не тот телефон, мошенническое
// объявление, — и это как раз те случаи, по которым потом спрашивают, что было
// на сайте и как быстро это убрали.
async function remove(id) {
  const row = await get(id);
  if (!row) throw new Error('Объявление не найдено');

  const target = row.vacancy_id
    ? { listingType: 'vacancy', listingId: row.vacancy_id }
    : row.order_id
      ? { listingType: 'order', listingId: row.order_id }
      : row.board_post_id
        ? { listingType: 'board', listingId: row.board_post_id }
        : null;
  if (!target) throw new Error('Это объявление на сайт не уходило');

  // Записка на доске могла пропасть сама — тогда удалять уже нечего, но пометить
  // импорт отклонённым всё равно надо, иначе кнопка так и будет предлагать удаление.
  await moderation.removeWithLog({ ...target, actor: 'bot', reason: 'снято через бота' });

  await reject(id);
  invalidate('home:');
}

module.exports = { create, get, setParsed, setCard, reject, publish, validate, applyDefaults, countToday, remove };

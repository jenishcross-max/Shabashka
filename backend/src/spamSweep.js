const db = require('./db');
const spam = require('./spam');
const moderation = require('./moderation');
const blocklist = require('./telegram/blocklist');
const { phonesIn } = require('./phone');
const { invalidate } = require('./cache');

// Проверка уже опубликованного фильтром (см. spam.js).
//
// Фильтр смотрит пост один раз — когда тот приходит. Всё, что вышло до правки
// правил, остаётся на сайте: в октябре 2026 вербовщики написали «ЗАГСтагылар
// кабыл алынбайт» вместо «жарабайт», и «доверенности за подработку» неделями
// висели в ленте. После каждой правки правил админ прогоняет ими всю ленту и
// снимает найденное разом, а не по одному.
//
// Текст — всё, что видит посетитель: у вакансии требования и условия лежат
// отдельно от описания, и схема может сидеть именно там.
const SOURCES = {
  order: {
    link: 'order_id',
    sql: `SELECT x.id, x.title, concat_ws(E'\\n', x.title, x.description) AS text,
                 x.whatsapp_phone AS phone, x.is_imported, x.created_at,
                 EXISTS (SELECT 1 FROM imported_listings il WHERE il.order_id = x.id AND il.is_ad) AS is_ad
            FROM orders x WHERE x.status = 'open'`,
  },
  vacancy: {
    link: 'vacancy_id',
    sql: `SELECT x.id, x.title, concat_ws(E'\\n', x.title, x.description, x.requirements, x.conditions) AS text,
                 x.whatsapp_phone AS phone, x.is_imported, x.created_at,
                 EXISTS (SELECT 1 FROM imported_listings il WHERE il.vacancy_id = x.id AND il.is_ad) AS is_ad
            FROM vacancies x WHERE x.status = 'open'`,
  },
  // Объявления: и поданные на сайте, и пришедшие из групп (бывшая «Доска»).
  ad: {
    link: 'ad_id',
    sql: `SELECT x.id, x.title, concat_ws(E'\\n', x.title, x.description) AS text,
                 x.whatsapp_phone AS phone, x.is_imported, x.created_at,
                 EXISTS (SELECT 1 FROM imported_listings il WHERE il.ad_id = x.id AND il.is_ad) AS is_ad
            FROM ads x WHERE x.status = 'open'`,
  },
  // Доска: только то, что видно, — скрытое модератором и истёкшее не в счёт.
  board: {
    link: 'board_post_id',
    sql: `SELECT x.id, left(x.text, 80) AS title, x.text,
                 x.whatsapp_phone AS phone, x.is_imported, x.created_at,
                 EXISTS (SELECT 1 FROM imported_listings il WHERE il.board_post_id = x.id AND il.is_ad) AS is_ad
            FROM board_posts x WHERE NOT x.hidden AND x.expires_at > NOW()`,
  },
};

// Строки одного типа: все опубликованные или только перечисленные.
async function rowsOf(type, ids = null) {
  const { sql } = SOURCES[type];
  const { rows } = ids
    ? await db.query(`${sql} AND x.id = ANY($1::int[])`, [ids])
    : await db.query(sql);
  return rows;
}

// Платная реклама проверяется мягче: сетевой маркетинг за деньги выкладывать
// можно, оформление на чужие документы — нельзя и за деньги (см. spam.check).
const verdict = (row) => spam.check(row.text, { ad: row.is_ad });

async function find() {
  const items = [];
  for (const type of Object.keys(SOURCES)) {
    for (const row of await rowsOf(type)) {
      const found = verdict(row);
      if (!found) continue;
      items.push({
        type,
        id: row.id,
        title: row.title,
        excerpt: String(row.text).replace(/\s+/g, ' ').slice(0, 300),
        kind: found.kind,
        label: spam.LABELS[found.kind],
        reason: spam.describe(found),
        is_imported: row.is_imported,
        created_at: row.created_at,
      });
    }
  }
  return items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Снять отмеченное. Каждый пост перед снятием проверяем заново: страница могла
// устареть, а по ошибке прислать id честного объявления — тем более. Снимаем
// только то, что фильтр считает мусором прямо сейчас.
async function remove(items, actor) {
  const wanted = {};
  for (const item of Array.isArray(items) ? items : []) {
    const id = Number(item && item.id);
    if (!item || !SOURCES[item.type] || !Number.isInteger(id) || id <= 0) continue;
    (wanted[item.type] = wanted[item.type] || []).push(id);
  }

  let removed = 0;
  const phones = new Set();
  for (const [type, ids] of Object.entries(wanted)) {
    for (const row of await rowsOf(type, ids)) {
      const found = verdict(row);
      if (!found) continue;
      const reason = spam.describe(found);
      // Импорт помечаем снятым до удаления: потом ссылка на пост обнулится, и
      // бот в «📥 Из групп» предлагал бы снять то, чего уже нет.
      await db.query(
        `UPDATE imported_listings SET status = 'rejected' WHERE ${SOURCES[type].link} = $1 AND status = 'published'`,
        [row.id]
      );
      if (await moderation.removeWithLog({ listingType: type, listingId: row.id, actor, reason })) removed += 1;
      // Номер вербовщика — в чёрный список, как делает бот с постами из групп:
      // завтра тот же человек пришлёт то же другими словами.
      for (const phone of phonesIn(row.phone || '')) phones.add(phone);
    }
  }

  const blocked = phones.size ? await blocklist.add([...phones], 'снято проверкой опубликованного') : 0;
  if (removed) invalidate('home:');
  return { removed, blocked };
}

module.exports = { find, remove };

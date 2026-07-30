const db = require('./db');
const moderation = require('./moderation');
const tg = require('./telegram/api');
const { notifyAdmins } = require('./telegram/notify');

// Причину обрезаем, а не отклоняем: человек, которого обманули, пишет длинно, и
// терять его жалобу из-за лимита было бы худшим из возможных ответов.
const MAX_REASON = 1000;

const SITE_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const PATHS = { order: 'orders', vacancy: 'vacancies' };

function listingLink(listingType, listingId) {
  if (!SITE_URL) return '';
  // У записки на доске своей страницы нет — ведём на доску с якорем, пока она жива.
  return listingType === 'board'
    ? `${SITE_URL}/board#p${listingId}`
    : `${SITE_URL}/${PATHS[listingType]}/${listingId}`;
}

// Жалоба вместе со снимком объявления. Снимок здесь, а не только в журнале
// модерации: пока жалобу разбирают, автор успевает поправить текст или снять
// объявление, и без копии непонятно, на что вообще жаловались.
// Возвращает null, если объявления уже нет.
async function create({ listingType, listingId, reason }) {
  const snap = await moderation.snapshot(listingType, listingId);
  if (!snap) return null;

  const text = String(reason).trim().slice(0, MAX_REASON);
  const { rows } = await db.query(
    `INSERT INTO reports (listing_type, listing_id, reason, snapshot)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [listingType, listingId, text, snap]
  );

  const link = listingLink(listingType, listingId);
  const lines = [
    `⚑ Жалоба: ${moderation.labelFor(listingType)} №${listingId}`,
    '',
    tg.esc(moderation.describe(listingType, snap)),
    '',
    `Причина: ${tg.esc(text)}`,
  ];
  if (link) lines.push('', `<a href="${link}">Открыть объявление</a>`);
  if (SITE_URL) lines.push(`<a href="${SITE_URL}/admin/reports">Разобрать в админке</a>`);

  // Намеренно без await: жалоба уже в базе, и ответ жалобщику не должен ждать,
  // пока Telegram примет сообщение.
  notifyAdmins(lines.join('\n')).catch(() => {});

  return rows[0].id;
}

module.exports = { create, MAX_REASON };

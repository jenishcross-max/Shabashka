const db = require('../db');

// Переписки ИИ-продавца в базе. В памяти их держать нельзя по той же причине,
// что и отложенную рекламу: бесплатный Render перезапускается, а человек,
// которому только что отправили номер МБанка, пришлёт чек и через час.

// Сколько реплик помнить. Модели для понимания хватает последних двенадцати,
// остальное — чтобы админ в /dm видел, о чём был разговор.
const HISTORY_MAX = 40;
// Сколько ключей уже разобранных сообщений помнить. Расширение присылает
// последние сообщения переписки целиком, и новые среди них находим по ключу.
const SEEN_MAX = 300;

const json = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
};

function fromRow(row) {
  if (!row) return null;
  return {
    ...row,
    history: json(row.history, []),
    seen: json(row.seen, []),
    payment: json(row.payment, null),
  };
}

async function get(channel, peer) {
  const { rows } = await db.query('SELECT * FROM dm_chats WHERE channel = $1 AND peer = $2', [channel, peer]);
  return fromRow(rows[0]);
}

async function byId(id) {
  const { rows } = await db.query('SELECT * FROM dm_chats WHERE id = $1', [id]);
  return fromRow(rows[0]);
}

async function create(channel, peer, name) {
  await db.query(
    `INSERT INTO dm_chats (channel, peer, peer_name) VALUES ($1, $2, $3)
     ON CONFLICT (channel, peer) DO NOTHING`,
    [channel, peer, name || null]
  );
  return get(channel, peer);
}

async function save(chat) {
  await db.query(
    `UPDATE dm_chats SET peer_name = $2, stage = $3, lang = $4, ad_text = $5, ad_image = $6,
            history = $7, seen = $8, payment = $9, receipt_fails = $10, paused_until = $11,
            campaign_id = $12, updated_at = NOW()
      WHERE id = $1`,
    [
      chat.id,
      chat.peer_name || null,
      chat.stage,
      chat.lang || 'ru',
      chat.ad_text || null,
      chat.ad_image || null,
      JSON.stringify((chat.history || []).slice(-HISTORY_MAX)),
      JSON.stringify((chat.seen || []).slice(-SEEN_MAX)),
      chat.payment ? JSON.stringify(chat.payment) : null,
      chat.receipt_fails || 0,
      chat.paused_until || null,
      chat.campaign_id || null,
    ]
  );
}

async function byCampaign(campaignId) {
  const { rows } = await db.query('SELECT * FROM dm_chats WHERE campaign_id = $1', [campaignId]);
  return fromRow(rows[0]);
}

// Для /dm: свежие разговоры.
async function recent(limit = 10) {
  const { rows } = await db.query(
    `SELECT id, channel, peer, peer_name, stage, paused_until, updated_at, history
       FROM dm_chats ORDER BY updated_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(fromRow);
}

// С кем бот уже разговаривает. Расширение берёт из общей папки директа только
// эти разговоры: остальное — личная переписка владельца, и на сервер её
// отправлять незачем.
async function peers(channel) {
  const { rows } = await db.query(
    `SELECT peer FROM dm_chats WHERE channel = $1 AND updated_at > NOW() - INTERVAL '60 days'`,
    [channel]
  );
  return rows.map((row) => row.peer);
}

// Сообщения, которые бот пишет сам, а не в ответ: ссылка на вышедший пост,
// отчёт через сутки, решение админа по чеку. Расширение забирает их при каждом
// обходе директа.
async function queue(chatId, text) {
  await db.query('INSERT INTO dm_outbox (chat_id, text) VALUES ($1, $2)', [chatId, text]);
}

async function outbox(channel) {
  const { rows } = await db.query(
    `SELECT o.id, o.text, c.peer FROM dm_outbox o JOIN dm_chats c ON c.id = o.chat_id
      WHERE o.sent_at IS NULL AND c.channel = $1 AND o.created_at > NOW() - INTERVAL '3 days'
      ORDER BY o.id ASC LIMIT 20`,
    [channel]
  );
  return rows;
}

async function sent(id) {
  await db.query('UPDATE dm_outbox SET sent_at = NOW() WHERE id = $1', [id]);
}

async function receiptSeen(keys) {
  if (!keys.length) return false;
  const { rows } = await db.query('SELECT key FROM dm_receipts WHERE key = ANY($1)', [keys]);
  return rows.length > 0;
}

async function rememberReceipt(keys, chatId) {
  for (const key of keys) {
    await db.query('INSERT INTO dm_receipts (key, chat_id) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [
      key,
      chatId,
    ]);
  }
}

module.exports = {
  get,
  byId,
  create,
  save,
  byCampaign,
  recent,
  peers,
  queue,
  outbox,
  sent,
  receiptSeen,
  rememberReceipt,
  HISTORY_MAX,
};

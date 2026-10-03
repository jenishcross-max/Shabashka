const db = require('../db');
const tg = require('./api');
const feedStats = require('./feedStats');
const { clock } = require('./format');

// Реклама в группах Telegram — в тех же, из которых бот берёт вакансии.
//
// Рекламодатель платит за то, чтобы его увидели. Threads и Instagram — наши
// площадки, а люди, которые ищут работу, сидят в группах: туда бот и так
// заглядывает каждую минуту за объявлениями. Теперь оплаченная реклама уходит
// и туда — тем же текстом и с тем же файлом, что прислал рекламодатель.
//
// Пишет не бот, а юзер-сессия — тот же аккаунт, которым читаются группы (см.
// sourceWatcher.js): бота в чужую группу никто не добавит, а аккаунт в них уже
// состоит. Или отдельный аккаунт, если задан TELEGRAM_AD_SESSION_STRING, — так
// спокойнее: если Telegram ограничит рассылающий аккаунт, читающий продолжит
// работать.
//
// Один и тот же текст по десятку групп — ровно то, за что Telegram режет
// аккаунты, а админы групп банят. Поэтому:
//  • по одной группе, с паузой AD_GROUP_GAP_SECONDS (40–60 с) между постами;
//  • в одну группу — не чаще раза в AD_GROUP_COOLDOWN_MINUTES (60), сколько бы
//    реклам ни пришло: остальные ждут своей очереди;
//  • медленный режим группы и FLOOD_WAIT выжидаем, а не долбим;
//  • PEER_FLOOD — Telegram пометил аккаунт рассыльщиком: замолкаем на сутки и
//    говорим админу;
//  • группа, где писать нельзя (только админы, бан), выпадает из рассылки на
//    сутки — с причиной в меню «👥 Группы».

const HOUR_MS = 60 * 60 * 1000;

const list = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// Куда: AD_GROUPS, а без него — те же группы, из которых бот берёт вакансии.
const TARGETS = list(process.env.AD_GROUPS || process.env.SOURCE_CHANNEL);
const AD_SESSION = process.env.TELEGRAM_AD_SESSION_STRING || '';

const GAP_MS = Number(process.env.AD_GROUP_GAP_SECONDS || 40) * 1000;
const COOLDOWN_MS = Number(process.env.AD_GROUP_COOLDOWN_MINUTES || 60) * 60 * 1000;
// Реклама, которая полсуток не могла уйти (аккаунт ограничен, группа в
// медленном режиме), уже не та: рекламодатель ждал её сегодня.
const MAX_AGE_HOURS = 12;
// Сколько группа, где писать нельзя, пропускается, прежде чем попробовать
// снова: запреты в группах бывают и временными.
const BROKEN_MS = 24 * HOUR_MS;
const RESTRICTED_MS = 24 * HOUR_MS;
const TICK_MS = 15 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
// Подпись к файлу у обычного аккаунта — до 1024 знаков.
const CAPTION_MAX = 1024;
const TEXT_MAX = 4096;
const MIN_TEXT = 15;

// Почему в группу нельзя писать — по коду ошибки Telegram, человеческими словами.
const CLOSED = [
  [/CHAT_ADMIN_REQUIRED|CHAT_WRITE_FORBIDDEN/, 'писать могут только админы или аккаунт не вступил в группу'],
  [/CHAT_GUEST_SEND_FORBIDDEN/, 'чтобы писать, нужно вступить в группу'],
  [/USER_BANNED_IN_CHANNEL/, 'аккаунт заблокирован в этой группе'],
  [/CHAT_SEND_PLAIN_FORBIDDEN/, 'в группе запрещено писать текст'],
  [/CHAT_RESTRICTED/, 'группа ограничена Telegram'],
  [
    /CHANNEL_PRIVATE|CHANNEL_INVALID|CHAT_ID_INVALID|PEER_ID_INVALID|USERNAME_NOT_OCCUPIED|USERNAME_INVALID|Cannot find any entity/i,
    'группа недоступна: закрыта, удалена или аккаунт из неё вышел',
  ],
];
const MEDIA_FORBIDDEN = /CHAT_SEND_(MEDIA|PHOTOS|VIDEOS|GIFS|DOCS)_FORBIDDEN/;
const RESTRICTED = /PEER_FLOOD|USER_RESTRICTED/;

const codeOf = (err) => String((err && (err.errorMessage || err.message)) || '');
const isSlowMode = (err) => /SLOWMODE_WAIT/.test(codeOf(err)) || (err && err.constructor && err.constructor.name === 'SlowModeWaitError');
const isFloodWait = (err) => /FLOOD_WAIT|^FLOOD$/.test(codeOf(err)) || (err && err.constructor && err.constructor.name === 'FloodWaitError');

let client = null;
let me = null;
const ownIds = new Set();
const entities = new Map();
let nextSendAt = 0;
// Когда в очереди созреет ближайший пост. Пока его нет, tick базу не трогает:
// реклама приходит несколько раз в день, и спрашивать пустую очередь каждые
// 15 секунд — одиннадцать тысяч лишних запросов к базе в сутки.
let wakeAt = 0;
let restricted = null;
let timer = null;
let busy = false;

// Пауза между постами — с разбросом: ровный такт тоже выдаёт рассылку.
const gap = () => GAP_MS + Math.round(Math.random() * GAP_MS * 0.5);

// ─── Настройки из меню: рассылка вкл/выкл, выключенные группы, закрытые группы

const KEYS = { enabled: 'adgroups:enabled', off: 'adgroups:off', broken: 'adgroups:broken' };
let cached = null;

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function settings() {
  if (cached) return cached;
  const [enabled, off, broken] = await Promise.all(
    [KEYS.enabled, KEYS.off, KEYS.broken].map((key) => feedStats.getSetting(key).catch(() => null))
  );
  cached = { enabled: enabled !== '0', off: parseJson(off, []), broken: parseJson(broken, {}) };
  return cached;
}

async function save(patch) {
  cached = { ...(await settings()), ...patch };
  await feedStats.setSetting(KEYS.enabled, cached.enabled ? '1' : '0');
  await feedStats.setSetting(KEYS.off, JSON.stringify(cached.off));
  await feedStats.setSetting(KEYS.broken, JSON.stringify(cached.broken));
  return cached;
}

function brokenOf(state, target, now = Date.now()) {
  const mark = state.broken[target];
  return mark && now - mark.at < BROKEN_MS ? mark : null;
}

const isRestricted = (now = Date.now()) => Boolean(restricted && now < restricted.until);

// ─── Аккаунт

// Зовётся из sourceWatcher.start, когда юзер-сессия уже подключена: без неё
// писать в группы нечем.
async function start(readerClient, { apiId, apiHash } = {}) {
  if (!TARGETS.length || timer) return;
  try {
    client = AD_SESSION ? await connectOwn(apiId, apiHash) : readerClient;
    const self = await client.getMe();
    me = {
      id: String(self.id),
      name: [self.firstName, self.lastName].filter(Boolean).join(' '),
      username: self.username || '',
    };
    ownIds.add(me.id);
  } catch (err) {
    console.error('[группы] аккаунт для рекламы не поднять:', err.message);
    client = null;
    return;
  }
  timer = setInterval(() => tick().catch((err) => console.error('[группы]', err.message)), TICK_MS);
  timer.unref();
  console.log(
    `[группы] реклама уходит в ${TARGETS.length} групп(ы) от ${me.username ? `@${me.username}` : me.name}, пауза ${
      GAP_MS / 1000
    } с, в одну группу не чаще раза в ${COOLDOWN_MS / 60000} мин`
  );
}

async function connectOwn(apiId, apiHash) {
  const { TelegramClient } = require('telegram');
  const { StringSession } = require('telegram/sessions');
  const own = new TelegramClient(new StringSession(AD_SESSION), apiId, apiHash, { connectionRetries: 5 });
  await own.connect();
  return own;
}

// Своё сообщение в группе-источнике — наша же реклама. Разбирать её как
// вакансию нельзя: вышел бы дубль на сайте, а то и номер рекламодателя в
// чёрном списке, если отсев примет её за мусор.
function isOwn(message) {
  if (!message) return false;
  if (message.out) return true;
  const sender = message.senderId;
  return sender !== null && sender !== undefined && ownIds.has(String(sender));
}

async function resolve(target) {
  if (entities.has(target)) return entities.get(target);
  const entity = await client.getEntity(target);
  entities.set(target, entity);
  return entity;
}

function withTimeout(promise, ms) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Telegram не ответил')), ms);
    }),
  ]).finally(() => clearTimeout(timeout));
}

function usernameOf(entity) {
  if (!entity) return '';
  if (entity.username) return entity.username;
  const active = (entity.usernames || []).find((u) => u.active);
  return active ? active.username : '';
}

// Ссылка на пост: у публичной группы — по имени, у закрытой супергруппы — через
// /c/. У маленькой обычной группы ссылок на сообщения в Telegram нет вовсе.
function linkTo(entity, messageId) {
  if (!entity || !messageId) return null;
  const username = usernameOf(entity);
  if (username) return `https://t.me/${username}/${messageId}`;
  if (entity.className === 'Channel') return `https://t.me/c/${String(entity.id)}/${messageId}`;
  return null;
}

const titleOf = (entity, target) => (entity && entity.title) || target;

// ─── Очередь

// Поставить рекламу в очередь по группам. Сразу ничего не шлёт — это делает
// tick, по одной группе за раз. Возвращает, сколько встало и когда примерно
// уйдёт последняя: это строка в отчёте админу.
async function enqueue({ importId, chatId, text, media = null }) {
  if (!TARGETS.length) return { queued: 0, silent: true };
  if (!client) return { queued: 0, reason: 'аккаунт Telegram для групп не подключён' };
  // Длиннее 4096 знаков Telegram сообщение не примет — и три попытки ушли бы
  // впустую.
  const body = String(text || '').trim().slice(0, TEXT_MAX);
  if (body.length < MIN_TEXT) return { queued: 0, reason: 'без текста в группы не пишу' };
  const state = await settings();
  if (!state.enabled) return { queued: 0, reason: 'рассылка выключена (☰ Меню → 👥 Группы)' };
  if (isRestricted()) return { queued: 0, reason: `Telegram ограничил аккаунт за рассылку, пауза до ${clock(restricted.until)}` };

  const now = Date.now();
  const open = TARGETS.filter((target) => !state.off.includes(target) && !brokenOf(state, target, now));
  const { rows: done } = await db.query(
    "SELECT DISTINCT target FROM ad_group_posts WHERE import_id = $1 AND status IN ('pending', 'sent')",
    [importId]
  );
  const already = new Set(done.map((row) => row.target));
  const targets = open.filter((target) => !already.has(target));
  if (!targets.length) {
    return {
      queued: 0,
      reason: already.size ? 'эта реклама уже разослана или ждёт очереди' : 'все группы выключены или в них нельзя писать',
    };
  }

  // Когда группа освободится: последний пост в неё (вышедший или ждущий) плюс
  // перерыв. Две рекламы за десять минут не должны прийти в одну группу подряд.
  const { rows: busyRows } = await db.query(
    `SELECT target, MAX(COALESCE(sent_at, not_before)) AS last
       FROM ad_group_posts
      WHERE target = ANY($1) AND (status = 'pending' OR sent_at IS NOT NULL)
        AND created_at > NOW() - INTERVAL '2 days'
      GROUP BY target`,
    [targets]
  );
  const freeAt = new Map(busyRows.map((row) => [row.target, new Date(row.last).getTime() + COOLDOWN_MS]));

  const from = Math.max(now, nextSendAt);
  const plan = targets.map((target, i) => ({ target, when: Math.max(from + i * GAP_MS, freeAt.get(target) || 0) }));
  const meta =
    media && (media.width || media.duration)
      ? JSON.stringify({ width: media.width || 0, height: media.height || 0, duration: media.duration || 0 })
      : null;

  const params = [];
  const values = plan.map(({ target, when }) => {
    params.push(importId, chatId, target, body, media ? media.kind : null, media ? media.fileId : null, meta, new Date(when));
    const k = params.length - 8;
    return `($${k + 1}, $${k + 2}, $${k + 3}, $${k + 4}, $${k + 5}, $${k + 6}, $${k + 7}, $${k + 8})`;
  });
  await db.query(
    `INSERT INTO ad_group_posts (import_id, chat_id, target, text, media_kind, media_file_id, media_meta, not_before)
     VALUES ${values.join(', ')}`,
    params
  );
  wakeAt = Math.min(wakeAt, ...plan.map((p) => p.when));
  return {
    queued: plan.length,
    off: TARGETS.length - open.length,
    lastAt: Math.max(...plan.map((p) => p.when)),
  };
}

// Один заход: самый ранний созревший пост. По одному за раз — паузу между
// постами держит nextSendAt.
async function tick(now = Date.now()) {
  if (busy || !client || now < nextSendAt || now < wakeAt) return;
  busy = true;
  try {
    await db.query(
      `UPDATE ad_group_posts SET status = 'skipped', note = 'устарело: не ушло за ${MAX_AGE_HOURS} ч'
        WHERE status = 'pending' AND created_at < NOW() - INTERVAL '${MAX_AGE_HOURS} hours'`
    );
    const { rows } = await db.query(
      "SELECT * FROM ad_group_posts WHERE status = 'pending' AND not_before <= NOW() ORDER BY not_before, id LIMIT 1"
    );
    if (rows[0]) {
      await send(rows[0]);
      return;
    }
    const { rows: next } = await db.query("SELECT MIN(not_before) AS at FROM ad_group_posts WHERE status = 'pending'");
    wakeAt = next[0] && next[0].at ? new Date(next[0].at).getTime() : Infinity;
  } finally {
    busy = false;
  }
}

async function finish(row, status, { note = null } = {}) {
  await db.query('UPDATE ad_group_posts SET status = $2, note = $3 WHERE id = $1', [row.id, status, note]);
}

async function reschedule(row, delayMs, note = null) {
  await db.query(
    `UPDATE ad_group_posts SET not_before = NOW() + ($2 || ' milliseconds')::interval, attempts = attempts + 1, note = $3
      WHERE id = $1`,
    [row.id, String(Math.round(delayMs)), note]
  );
}

async function send(row) {
  const state = await settings();
  if (!state.enabled) return finish(row, 'skipped', { note: 'рассылку выключили' });
  if (state.off.includes(row.target)) return finish(row, 'skipped', { note: 'группу выключили' });
  const broken = brokenOf(state, row.target);
  if (broken) return finish(row, 'skipped', { note: broken.reason });
  if (isRestricted()) return null;

  let entity = null;
  try {
    entity = await resolve(row.target);
    const { message, note } = await deliver(entity, row);
    await db.query(
      `UPDATE ad_group_posts SET status = 'sent', message_id = $2, link = $3, title = $4, note = $5,
              sent_at = NOW(), attempts = attempts + 1
        WHERE id = $1`,
      [row.id, message.id, linkTo(entity, message.id), titleOf(entity, row.target), note || null]
    );
    feedStats.bump('adgrp.ok');
    nextSendAt = Date.now() + gap();
    return null;
  } catch (err) {
    return failed(row, err, entity);
  }
}

// Файл рекламодателя лежит в Telegram у бота (file_id Bot API) — юзер-сессии
// его надо скачать и залить заново: file_id бота ей не годится.
async function fileOf(row) {
  const buffer = await tg.downloadFile(row.media_file_id);
  const { CustomFile } = require('telegram/client/uploads');
  const video = row.media_kind === 'video';
  const file = new CustomFile(video ? 'reklama.mp4' : 'reklama.jpg', buffer.length, '', buffer);
  const meta = typeof row.media_meta === 'string' ? parseJson(row.media_meta, null) : row.media_meta;
  if (!video || !meta || !meta.width || !meta.height) return { file, attributes: undefined };
  // Без размеров Telegram показал бы ролик квадратиком 1×1 до первого запуска.
  const { Api } = require('telegram');
  const attributes = [
    new Api.DocumentAttributeVideo({
      duration: Number(meta.duration) || 0,
      w: Number(meta.width),
      h: Number(meta.height),
      supportsStreaming: true,
    }),
  ];
  return { file, attributes };
}

// Текст — как прислал рекламодатель, без разметки: звёздочки и подчёркивания в
// чужом тексте не должны превращаться в жирный шрифт.
async function deliver(entity, row) {
  const text = row.text;
  let note = '';
  if (row.media_file_id) {
    if (text.length > CAPTION_MAX) {
      note = 'текст длиннее подписи к файлу — ушёл без файла';
    } else {
      let file = null;
      try {
        file = await fileOf(row);
      } catch (err) {
        note = `файл не скачать (${err.message}) — ушёл текстом`;
      }
      if (file) {
        try {
          const message = await client.sendFile(entity, {
            file: file.file,
            caption: text,
            parseMode: false,
            attributes: file.attributes,
            supportsStreaming: row.media_kind === 'video',
            forceDocument: false,
          });
          return { message, note };
        } catch (err) {
          if (!MEDIA_FORBIDDEN.test(codeOf(err))) throw err;
          note = 'файлы в группе запрещены — ушёл текстом';
        }
      }
    }
  }
  const message = await client.sendMessage(entity, { message: text, parseMode: false, linkPreview: false });
  return { message, note };
}

async function failed(row, err, entity) {
  const code = codeOf(err);
  const seconds = Number(err && err.seconds) || 0;

  // Медленный режим — правило самой группы: ждём только её.
  if (isSlowMode(err)) return reschedule(row, (seconds + 5) * 1000, `медленный режим группы: ${seconds} с`);

  // FLOOD_WAIT — Telegram просит подождать весь аккаунт.
  if (isFloodWait(err)) {
    nextSendAt = Date.now() + (seconds + 5) * 1000;
    return reschedule(row, (seconds + 5) * 1000, `Telegram попросил подождать ${seconds} с`);
  }

  if (RESTRICTED.test(code)) {
    const fresh = !isRestricted();
    restricted = { until: Date.now() + RESTRICTED_MS };
    nextSendAt = restricted.until;
    await db.query(
      "UPDATE ad_group_posts SET status = 'skipped', note = $1 WHERE status = 'pending'",
      ['Telegram ограничил аккаунт за рассылку']
    );
    feedStats.bump('adgrp.fail');
    if (fresh) {
      await tg
        .sendMessage(
          row.chat_id,
          [
            '👥 Telegram ограничил аккаунт за рассылку (PEER_FLOOD): писать в группы ему пока нельзя.',
            `Рассылку рекламы в группы останавливаю до ${clock(restricted.until)}, очередь снял.`,
            'Проверить ограничение можно в @SpamBot с того же аккаунта. Чтение групп это не трогает.',
          ].join('\n')
        )
        .catch(() => {});
    }
    return null;
  }

  const closed = CLOSED.find(([re]) => re.test(code));
  if (closed) {
    const reason = closed[1];
    const title = titleOf(entity, row.target);
    await db.query('UPDATE ad_group_posts SET status = $2, note = $3, title = COALESCE($4, title) WHERE id = $1', [
      row.id,
      'failed',
      reason,
      entity ? title : null,
    ]);
    await db.query(
      "UPDATE ad_group_posts SET status = 'skipped', note = $2 WHERE status = 'pending' AND target = $1",
      [row.target, reason]
    );
    const state = await settings();
    await save({ broken: { ...state.broken, [row.target]: { reason, at: Date.now() } } });
    feedStats.bump('adgrp.fail');
    await tg
      .sendMessage(
        row.chat_id,
        `👥 В группу «${tg.esc(title)}» реклама не уходит: ${reason}. Пропускаю её сутки; вернуть сразу — ☰ Меню → 👥 Группы.`
      )
      .catch(() => {});
    return null;
  }

  if (row.attempts + 1 >= MAX_ATTEMPTS) {
    feedStats.bump('adgrp.fail');
    return finish(row, 'failed', { note: code.slice(0, 200) || 'ошибка Telegram' });
  }
  return reschedule(row, RETRY_MS, code.slice(0, 200));
}

// ─── Для меню

// Посты рекламы по группам. views — заодно спросить свежие просмотры: они есть
// только у каналов, в группах Telegram их не считает.
async function forImport(importId, { views = false } = {}) {
  const { rows } = await db.query('SELECT * FROM ad_group_posts WHERE import_id = $1 ORDER BY id', [importId]);
  if (!views || !client) return rows;
  const byTarget = new Map();
  for (const row of rows) {
    if (row.status !== 'sent' || !row.message_id) continue;
    if (!byTarget.has(row.target)) byTarget.set(row.target, []);
    byTarget.get(row.target).push(row);
  }
  for (const [target, sent] of byTarget) {
    try {
      const entity = await withTimeout(resolve(target), 5000);
      const messages = await withTimeout(client.getMessages(entity, { ids: sent.map((r) => Number(r.message_id)) }), 5000);
      for (const message of messages || []) {
        const row = message && sent.find((r) => Number(r.message_id) === message.id);
        if (!row || typeof message.views !== 'number') continue;
        row.views = message.views;
        await db.query('UPDATE ad_group_posts SET views = $2 WHERE id = $1', [row.id, message.views]);
      }
    } catch (err) {
      console.log(`[группы] просмотры в ${target} не узнать (${err.message})`);
    }
  }
  return rows;
}

// Просмотры поста в нашем канале. Бот их не видит — Bot API про просмотры
// молчит, — а юзер-сессия видит, если аккаунт подписан на канал.
async function channelViews(channel, messageId) {
  if (!client || !channel || !messageId) return null;
  const peer = /^-?\d+$/.test(String(channel)) ? Number(channel) : channel;
  const [message] = await withTimeout(client.getMessages(peer, { ids: [Number(messageId)] }), 5000);
  return message && typeof message.views === 'number' ? message.views : null;
}

// Снять рекламу из групп вместе с остальным (кнопка 🗑): ждущие посты
// отменить, вышедшие удалить. Свои сообщения в группе аккаунт удалять может.
async function unpublish(importId) {
  const { rows: cancelled } = await db.query(
    "UPDATE ad_group_posts SET status = 'skipped', note = 'рекламу сняли' WHERE import_id = $1 AND status = 'pending' RETURNING id",
    [importId]
  );
  const { rows } = await db.query("SELECT * FROM ad_group_posts WHERE import_id = $1 AND status = 'sent'", [importId]);
  let deleted = 0;
  const failedRows = [];
  for (const row of rows) {
    try {
      if (!client) throw new Error('аккаунт Telegram не подключён');
      const entity = await resolve(row.target);
      await client.deleteMessages(entity, [Number(row.message_id)], { revoke: true });
      await db.query("UPDATE ad_group_posts SET status = 'deleted' WHERE id = $1", [row.id]);
      deleted += 1;
    } catch (err) {
      failedRows.push({ title: row.title || row.target, link: row.link, reason: err.message });
    }
  }
  return { cancelled: cancelled.length, deleted, failed: failedRows };
}

// Что показать в меню «👥 Группы».
async function overview() {
  const state = await settings();
  const { rows } = await db.query(
    `SELECT target, MAX(sent_at) AS last_sent,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE sent_at > NOW() - INTERVAL '7 days')::int AS week
       FROM ad_group_posts GROUP BY target`
  );
  const byTarget = new Map(rows.map((row) => [row.target, row]));
  const groups = [];
  for (const target of TARGETS) {
    let title = target;
    if (client) {
      try {
        title = titleOf(await withTimeout(resolve(target), 5000), target);
      } catch {
        // название — для красоты; без него покажем как записано в настройках
      }
    }
    const row = byTarget.get(target) || {};
    groups.push({
      target,
      title,
      off: state.off.includes(target),
      broken: brokenOf(state, target),
      lastSent: row.last_sent || null,
      pending: row.pending || 0,
      week: row.week || 0,
    });
  }
  return {
    enabled: state.enabled,
    connected: Boolean(client),
    account: me,
    separate: Boolean(AD_SESSION),
    restrictedUntil: isRestricted() ? restricted.until : null,
    groups,
    gapSec: Math.round(GAP_MS / 1000),
    cooldownMin: Math.round(COOLDOWN_MS / 60000),
    brokenHours: Math.round(BROKEN_MS / HOUR_MS),
  };
}

// Рассылка целиком: выключили — и то, что ждало очереди, не уйдёт.
async function setEnabled(on) {
  await save({ enabled: Boolean(on) });
  if (!on) {
    await db.query("UPDATE ad_group_posts SET status = 'skipped', note = 'рассылку выключили' WHERE status = 'pending'");
  }
}

// Одна группа: выключенную или закрытую — включить (и забыть, почему была
// закрыта), включённую — выключить.
async function toggle(index) {
  const target = TARGETS[Number(index)];
  if (!target) return null;
  const state = await settings();
  const closed = state.off.includes(target) || brokenOf(state, target);
  if (closed) {
    const broken = { ...state.broken };
    delete broken[target];
    await save({ off: state.off.filter((t) => t !== target), broken });
    return { target, on: true };
  }
  await save({ off: [...state.off, target] });
  await db.query(
    "UPDATE ad_group_posts SET status = 'skipped', note = 'группу выключили' WHERE status = 'pending' AND target = $1",
    [target]
  );
  return { target, on: false };
}

module.exports = {
  start,
  isOwn,
  enqueue,
  tick,
  forImport,
  channelViews,
  unpublish,
  overview,
  setEnabled,
  toggle,
  linkTo,
  TARGETS,
  GAP_MS,
  COOLDOWN_MS,
  // для тестов
  _reset: () => {
    client = null;
    me = null;
    ownIds.clear();
    entities.clear();
    nextSendAt = 0;
    wakeAt = 0;
    restricted = null;
    cached = null;
    busy = false;
    if (timer) clearInterval(timer);
    timer = null;
  },
  _use: (given, self = null) => {
    client = given;
    if (self) {
      me = self;
      ownIds.add(String(self.id));
    }
  },
};

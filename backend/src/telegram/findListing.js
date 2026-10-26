// «🔎 Найти и снять» — объявление по номеру, ссылке, телефону или словам из
// заголовка, и кнопка «🗑» под ним.
//
// Снять объявление бот умел и раньше — кнопкой в «📥 Опубликованное», — но там
// они идут подряд по десять, а за день их выходят сотни: автор пишет «уберите
// вакансию 6683», и листать до неё нельзя. Здесь её находят одним сообщением.
//
// Ищем по самому сайту (вакансии, заказы, объявления), а не по списку
// пришедшего из групп: так находится и поданное людьми на сайте. Если
// объявление пришло через бота — у него есть посты на площадках, и «🗑» ведёт
// в ту же дорогу, что в «📥 Опубликованное» (ldel в bot.js): сайт, пост в
// канале, Threads, ссылка на ролик в Instagram. Поданное на сайте в соцсети не
// уходило — его снимаем только с сайта, со снимком в журнал модерации.
const db = require('../db');
const moderation = require('../moderation');
const { invalidate } = require('../cache');

const TTL_MS = 15 * 60 * 1000;
const LIMIT = 8;

// chatId → до какого времени ждём запрос. В памяти: после перезапуска
// достаточно нажать кнопку ещё раз.
const waiting = new Map();

const SITE_ONLY = 'В канал и соцсети не уходило: подано на сайте.';
const TYPES = {
  vacancy: {
    table: 'vacancies',
    icon: '💼',
    label: 'вакансия',
    removed: (id) => `Вакансия № ${id} снята с сайта. ${SITE_ONLY}`,
  },
  order: { table: 'orders', icon: '🧰', label: 'заказ', removed: (id) => `Заказ № ${id} снят с сайта. ${SITE_ONLY}` },
  ad: {
    table: 'ads',
    icon: '🏷',
    label: 'объявление',
    removed: (id) => `Объявление № ${id} снято с сайта. ${SITE_ONLY}`,
  },
};
const BY_PATH = { vacancies: 'vacancy', orders: 'order', ads: 'ad' };

// Что прислали: ссылку на объявление, его номер, телефон или слова. Номер на
// сайте — до семи цифр, телефон — от девяти: путать их не приходится.
function parseQuery(raw) {
  const text = String(raw || '').trim();
  const link = text.match(/\/(vacancies|orders|ads)\/(\d+)/);
  if (link) return { type: BY_PATH[link[1]], id: Number(link[2]) };
  const number = text.match(/^[#№]?\s*(\d{1,7})$/);
  if (number) return { id: Number(number[1]) };
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 9 && digits.length <= 13 && !/[^\d\s+()-]/.test(text)) return { phone: digits.slice(-9) };
  return text.length >= 2 ? { text } : null;
}

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// До LIMIT совпадений, сначала новые. У каждого — пост из бота, если он был:
// по нему видно, где ещё висит объявление и откуда его снимет «🗑».
async function search(query) {
  const types = query.type ? [query.type] : Object.keys(TYPES);
  let cond;
  let value;
  if (query.id) {
    cond = 'id = $1';
    value = query.id;
  } else if (query.phone) {
    cond = "regexp_replace(COALESCE(whatsapp_phone, ''), '\\D', '', 'g') LIKE $1";
    value = `%${query.phone}`;
  } else {
    cond = 'title ILIKE $1';
    value = `%${likeEscape(query.text)}%`;
  }
  const parts = types.map(
    (type) =>
      `SELECT '${type}' AS type, id, title, city, whatsapp_phone AS phone, status, created_at
         FROM ${TYPES[type].table} WHERE ${cond}`
  );
  const { rows } = await db.query(
    `WITH found AS (${parts.join(' UNION ALL ')})
     SELECT f.*, i.id AS import_id, i.channel_message_id, i.threads_post_id, i.instagram_media_id, i.is_ad
       FROM found f
       LEFT JOIN LATERAL (
         SELECT * FROM imported_listings
          WHERE status = 'published'
            AND CASE f.type WHEN 'vacancy' THEN vacancy_id WHEN 'order' THEN order_id ELSE ad_id END = f.id
          ORDER BY id DESC LIMIT 1
       ) i ON true
      ORDER BY f.created_at DESC, f.id DESC
      LIMIT ${LIMIT}`,
    [value]
  );
  return rows;
}

function describeQuery(query) {
  if (query.id) return `№ ${query.id}`;
  if (query.phone) return `номер …${query.phone.slice(-6)}`;
  return `«${query.text}»`;
}

// Список найденного. Под каждым — «🗑 N»: пришедшее через бота снимает дорога
// ldel (bot.js) — отовсюду; поданное на сайте — fd:del, только с сайта.
function resultsView(rows, query, { esc, url }) {
  if (!rows.length) {
    return {
      text: [
        `🔎 По запросу ${esc(describeQuery(query))} ничего не нашёл.`,
        '',
        'Пришлите номер (6683), ссылку на объявление, телефон или слова из заголовка.',
      ].join('\n'),
    };
  }
  const lines = [`🔎 <b>Нашёл: ${rows.length}</b>${rows.length === LIMIT ? ' (показываю первые)' : ''}`, ''];
  const buttons = [];
  rows.forEach((row, i) => {
    const t = TYPES[row.type];
    const n = i + 1;
    const link = url(row.type, row.id);
    const title = esc(String(row.title || 'без названия').slice(0, 70));
    const where = ['сайт'];
    if (row.channel_message_id) where.push('канал');
    if (row.threads_post_id) where.push('Threads');
    if (row.instagram_media_id) where.push('Instagram');
    lines.push(
      `${n}. ${t.icon} ${link ? `<a href="${link}">${title}</a>` : title}`,
      [
        `${t.label} № ${row.id}`,
        row.city && esc(row.city),
        row.phone && esc(row.phone),
        row.status === 'open' ? `висит: ${where.join(', ')}` : 'уже закрыто',
        row.is_ad && '📣 реклама',
      ]
        .filter(Boolean)
        .join(' · ')
    );
    buttons.push({
      text: `🗑 ${n}`,
      callback_data: row.import_id ? `ldel:${row.import_id}` : `fd:del:${row.type}:${row.id}`,
    });
  });
  lines.push('', '🗑 — снять отовсюду, где висит: сайт, канал, Threads; на ролик в Instagram дам ссылку.');
  const rows5 = [];
  for (let i = 0; i < buttons.length; i += 4) rows5.push(buttons.slice(i, i + 4));
  return { text: lines.join('\n'), extra: { reply_markup: { inline_keyboard: rows5 }, disable_web_page_preview: true } };
}

const PROMPT = [
  '🔎 <b>Найти и снять</b>',
  '',
  'Пришлите номер объявления (например, 6683), ссылку на него, телефон автора или слова из заголовка.',
  '/cancel — отменить.',
].join('\n');

async function prompt(chatId, deps) {
  waiting.set(chatId, Date.now() + TTL_MS);
  await deps.send(chatId, PROMPT);
}

// Поиск — по /find с запросом сразу или следом за кнопкой.
async function find(chatId, raw, deps) {
  const query = parseQuery(raw);
  if (!query) {
    await prompt(chatId, deps);
    return;
  }
  const view = resultsView(await search(query), query, deps);
  await deps.send(chatId, view.text, view.extra);
}

// Сообщение админа. true — наше, дальше его не разбирать.
async function onMessage(message, deps, { isMenuKey = () => false } = {}) {
  const chatId = message.chat.id;
  const text = String(message.text || '').trim();

  const command = text.match(/^\/find(?:@\S+)?(?:\s+([^]*))?$/i);
  if (command) {
    waiting.delete(chatId);
    await find(chatId, command[1] || '', deps);
    return true;
  }

  const until = waiting.get(chatId);
  if (!until) return false;
  waiting.delete(chatId);
  if (until < Date.now()) return false;
  if (/^\/cancel\b/i.test(text)) {
    await deps.send(chatId, 'Ок, отменил.');
    return true;
  }
  // Команда, кнопка меню или фото — админ занялся другим.
  if (!text || text.startsWith('/') || isMenuKey(text)) return false;
  await find(chatId, text, deps);
  return true;
}

// Кнопки. true — наша.
async function onCallback(query, deps) {
  const [scope, action, type, rawId] = String(query.data || '').split(':');
  if (scope !== 'fd') return false;
  const chatId = query.message.chat.id;

  if (action === 'start') {
    await deps.answer(query.id, '');
    await prompt(chatId, deps);
    return true;
  }

  if (action === 'del' && TYPES[type]) {
    const id = Number(rawId);
    const removed = await moderation.removeWithLog({
      listingType: type,
      listingId: id,
      actor: 'bot',
      reason: 'снято через бота: поиск',
    });
    await deps.answer(query.id, removed ? 'Снял с сайта' : 'Уже снято');
    if (removed) {
      invalidate('home:');
      await deps.send(chatId, `🗑 ${TYPES[type].removed(id)}`);
    }
    return true;
  }

  await deps.answer(query.id, '');
  return true;
}

module.exports = { parseQuery, search, resultsView, prompt, find, onMessage, onCallback, TTL_MS };

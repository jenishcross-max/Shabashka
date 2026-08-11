// Автоимпорт вакансий из чужого Telegram-канала — без пересылки руками.
//
// Бот из bot.js видит только то, что ему прислали лично: скриншот или
// пересланное сообщение. Канал-источник — чужой (админ там просто подписчик),
// а Bot API не даёт читать посты в канале, где бот не администратор. Поэтому
// здесь не бот, а юзер-сессия (MTProto, библиотека GramJS) — то же самое, что
// открытый Telegram на телефоне админа, только без интерфейса. Она видит
// каждый новый пост в канале и сама отдаёт его в тот же разбор и ту же
// публикацию, которыми идут скриншоты из личных сообщений (bot.ingestFromSource
// = handleParsed из bot.js) — очередь, дедуп, отчёт в чат, retry соцсетей,
// всё общее, копии логики нет.
//
// Юзер-сессию нельзя завести программно — Telegram присылает код входа в само
// приложение, и его вводит живой человек один раз. Для этого есть отдельный
// скрипт `npm run telegram-login` (см. loginSession.js): он выдаёт строку
// TELEGRAM_SESSION_STRING, которую достаточно один раз вписать в .env (и в
// переменные окружения на Render) — дальше сессия переживает перезапуски сама.
const extract = require('./extract');
const queue = require('./queue');
const bot = require('./bot');
const { ADMIN_IDS } = require('./notify');

const API_ID = Number(process.env.TELEGRAM_API_ID || 0);
const API_HASH = process.env.TELEGRAM_API_HASH || '';
const SESSION_STRING = process.env.TELEGRAM_SESSION_STRING || '';

// Один или несколько каналов через запятую: @username или числовой id.
const SOURCES = String(process.env.SOURCE_CHANNEL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Канал читает подписчик, а не владелец, и контент там смешанный (не только
// вакансии). Раз в задаче стоит именно «вакансии», по умолчанию публикуем
// только listing_type = vacancy, остальное из этого источника молча пропускаем —
// SOURCE_LISTING_TYPE=all снимает фильтр, если понадобится всё подряд.
const FORCE_TYPE = (process.env.SOURCE_LISTING_TYPE || 'vacancy').trim();

// Отчёт о публикации (тот же формат, что и у ручных скриншотов: карточка,
// кнопка удаления, статус по соцсетям) уходит в личку админу — по умолчанию
// первому из TELEGRAM_ADMIN_IDS, если отдельный чат не задан явно.
const REPORT_CHAT_ID = process.env.SOURCE_REPORT_CHAT_ID || [...ADMIN_IDS][0] || null;

function isConfigured() {
  return Boolean(API_ID && API_HASH && SESSION_STRING && SOURCES.length && REPORT_CHAT_ID);
}

// Короткие сообщения ("+", "salam") и так отсеет модель через is_listing, но
// гонять на них Groq — пустой перевод квоты. Тот же порог, что и в bot.js.
const MIN_TEXT_LENGTH = 15;

async function handleNewMessage(client, event) {
  const message = event.message;
  if (!message) return;

  const text = String(message.message || '').trim();
  const hasPhoto = Boolean(message.photo);
  if (!hasPhoto && text.length < MIN_TEXT_LENGTH) return;

  // В общую очередь разбора (backend/src/telegram/queue.js) — она же держит
  // темп для скриншотов из личных сообщений и не даёт улететь в лимит Groq,
  // если из канала и от админа в личку прилетело одновременно.
  queue.add(async () => {
    try {
      const listings = hasPhoto
        ? await extract.fromImage(await client.downloadMedia(message, {}), 'image/jpeg')
        : await extract.fromText(text);

      const filtered =
        FORCE_TYPE === 'all'
          ? listings.filter((p) => p.is_listing && p.listing_type !== 'other')
          : listings.filter((p) => p.is_listing && p.listing_type === FORCE_TYPE);

      if (!filtered.length) return;

      await bot.ingestFromSource(REPORT_CHAT_ID, filtered, {
        source: 'channel',
        rawText: text || null,
      });
    } catch (err) {
      console.error('Автоимпорт из канала:', err.message);
    }
  });
}

let client = null;

async function start() {
  if (!isConfigured()) {
    console.log(
      'Автоимпорт из канала выключен (нужны TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION_STRING, SOURCE_CHANNEL и хотя бы один админ в TELEGRAM_ADMIN_IDS)'
    );
    return;
  }

  // Требуются только при настроенном источнике — держим их не на верхнем
  // уровне модуля, чтобы отсутствие пакета не роняло сервер, если автоимпорт
  // вообще не используется.
  const { TelegramClient } = require('telegram');
  const { StringSession } = require('telegram/sessions');
  const { NewMessage } = require('telegram/events');

  client = new TelegramClient(new StringSession(SESSION_STRING), API_ID, API_HASH, {
    connectionRetries: 5,
  });
  await client.connect();

  // NewMessage сам резолвит username/id в сущность — передавать сюда уже
  // готовый объект (client.getEntity(...)) нельзя: внутренний _getEntityFromString
  // не понимает такой тип и падает с "Cannot find any entity corresponding to
  // [object Object]", роняя весь процесс.
  client.addEventHandler((event) => handleNewMessage(client, event), new NewMessage({ chats: SOURCES }));

  console.log(`Автоимпорт из канала включён: ${SOURCES.join(', ')} → только ${FORCE_TYPE === 'all' ? 'все объявления' : FORCE_TYPE}`);
}

module.exports = { start, isConfigured };

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
  if (!message) {
    console.log('[источник] апдейт без message — пропускаю');
    return;
  }

  const text = String(message.message || '').trim();
  const hasPhoto = Boolean(message.photo);
  console.log(
    `[источник] новое сообщение: ${hasPhoto ? 'фото' : `текст (${text.length} симв.)`} — "${text.slice(0, 60)}"`
  );

  if (!hasPhoto && text.length < MIN_TEXT_LENGTH) {
    console.log('[источник] короче порога — пропускаю без разбора');
    return;
  }

  // В общую очередь разбора (backend/src/telegram/queue.js) — она же держит
  // темп для скриншотов из личных сообщений и не даёт улететь в лимит Groq,
  // если из канала и от админа в личку прилетело одновременно.
  queue.add(async () => {
    try {
      const listings = hasPhoto
        ? await extract.fromImage(await client.downloadMedia(message, {}), 'image/jpeg')
        : await extract.fromText(text);

      console.log(
        `[источник] Groq разобрал: ${listings
          .map((p) => `is_listing=${p.is_listing} type=${p.listing_type}`)
          .join('; ') || 'пусто'}`
      );

      const filtered =
        FORCE_TYPE === 'all'
          ? listings.filter((p) => p.is_listing && p.listing_type !== 'other')
          : listings.filter((p) => p.is_listing && p.listing_type === FORCE_TYPE);

      if (!filtered.length) {
        console.log(`[источник] после фильтра "${FORCE_TYPE}" не осталось ни одного — не публикую`);
        return;
      }

      console.log(`[источник] публикую ${filtered.length} объявление(й)`);
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
  const { NewMessage, Raw } = require('telegram/events');

  client = new TelegramClient(new StringSession(SESSION_STRING), API_ID, API_HASH, {
    connectionRetries: 5,
  });
  await client.connect();

  // Заранее резолвим канал и заносим его в кэш сущностей сессии — без этого
  // при первом же посте после рестарта NewMessage может не опознать чат по
  // username (сравнение идёт по уже закэшированным сущностям).
  for (const s of SOURCES) {
    try {
      const entity = await client.getEntity(s);
      console.log(`[источник] канал найден: ${s} → id ${entity.id}`);
    } catch (err) {
      console.error(`[источник] не смог найти канал "${s}": ${err.message}`);
    }
  }

  // У каналов и супергрупп своя последовательность обновлений (pts), отдельная
  // от обычных чатов, и сервер начинает пушить в реальном времени только те
  // каналы, для которых у клиента уже есть начальное состояние. getDialogs()
  // разом подтягивает список диалогов (и тем самым состояние каждого канала) —
  // без этого шага сессия, ни разу не открывавшая канал, может вообще не
  // получать по нему живые апдейты, только пассивные (прочитано/не прочитано).
  try {
    const dialogs = await client.getDialogs({ limit: 200 });
    console.log(`[источник] диалоги подтянуты: ${dialogs.length}`);
  } catch (err) {
    console.error('[источник] не смог подтянуть диалоги:', err.message);
  }

  // Временная диагностика: показывает вообще все входящие апдейты, чтобы
  // понять, доходят ли посты канала до клиента, даже если NewMessage их
  // почему-то не подхватывает. Служебные апдейты (статус соединения, "в сети")
  // логируем коротко, остальные — целиком, с меткой времени для сверки с
  // моментом отправки тестового сообщения.
  const NOISY = new Set(['UpdateConnectionState', 'UpdateUserStatus']);
  client.addEventHandler((update) => {
    const name = update.className || update.constructor?.name;
    if (NOISY.has(name)) return;
    console.log(`[источник][raw] ${new Date().toISOString()} ${name}`, JSON.stringify(update, null, 0).slice(0, 500));
  }, new Raw({}));

  // NewMessage сам резолвит username/id в сущность — передавать сюда уже
  // готовый объект (client.getEntity(...)) нельзя: внутренний _getEntityFromString
  // не понимает такой тип и падает с "Cannot find any entity corresponding to
  // [object Object]", роняя весь процесс.
  client.addEventHandler((event) => handleNewMessage(client, event), new NewMessage({ chats: SOURCES }));

  console.log(
    `Автоимпорт из канала включён: ${SOURCES.join(', ')} → только ${FORCE_TYPE === 'all' ? 'все объявления' : FORCE_TYPE} (SOURCE_CHANNEL="${process.env.SOURCE_CHANNEL}")`
  );
}

module.exports = { start, isConfigured };

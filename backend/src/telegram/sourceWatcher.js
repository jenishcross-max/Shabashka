// Автоимпорт вакансий из чужого Telegram-канала — без пересылки руками.
//
// Бот из bot.js видит только то, что ему прислали лично: скриншот или
// пересланное сообщение. Канал-источник — чужой (админ там просто подписчик),
// а Bot API не даёт читать посты в канале, где бот не администратор. Поэтому
// здесь не бот, а юзер-сессия (MTProto, библиотека GramJS) — то же самое, что
// открытый Telegram на телефоне админа, только без интерфейса. Она читает
// новые посты и сама отдаёт их в тот же разбор и ту же публикацию, которыми
// идут скриншоты из личных сообщений (bot.ingestFromSource = handleParsed из
// bot.js) — очередь, дедуп, отчёт в чат, retry соцсетей, всё общее, копии
// логики нет.
//
// Читаем опросом, а не подпиской на события. Подписка (NewMessage/Raw) не
// заработала: сессия видела по группе служебные апдейты (кто печатает,
// удаление, отметки о прочтении), а UpdateNewChannelMessage не приходил
// вообще — у каналов и супергрупп своя последовательность обновлений, и
// сервер её этому клиенту просто не пушил, сколько ни грей кэш сущностей и
// getDialogs. Опрос от этого не зависит: раз в минуту спрашиваем «что нового
// с прошлого раза» и получаем ровно то, что видно в самом Telegram.
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

// По умолчанию публикуем вакансии и заказы, доску объявлений (board) — нет:
// в задаче стоят именно эти два типа. Список через запятую (vacancy,order,board),
// либо all — снять фильтр совсем, кроме явного мусора (listing_type = other).
const FORCE_TYPES = String(process.env.SOURCE_LISTING_TYPE || 'vacancy,order')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const FORCE_ALL = FORCE_TYPES.includes('all');

// Отчёт о публикации (тот же формат, что и у ручных скриншотов: карточка,
// кнопка удаления, статус по соцсетям) уходит в личку админу — по умолчанию
// первому из TELEGRAM_ADMIN_IDS, если отдельный чат не задан явно.
const REPORT_CHAT_ID = process.env.SOURCE_REPORT_CHAT_ID || [...ADMIN_IDS][0] || null;

// Минута — компромисс: объявление доезжает почти сразу, а запросов к Telegram
// за сутки меньше полутора тысяч, это ничтожно мало.
const POLL_MS = Number(process.env.SOURCE_POLL_SECONDS || 60) * 1000;

// Сколько сообщений забираем за один опрос. Если в группе за минуту написали
// больше — остальное подберётся следующим опросом.
const BATCH = 30;

function isConfigured() {
  return Boolean(API_ID && API_HASH && SESSION_STRING && SOURCES.length && REPORT_CHAT_ID);
}

// Короткие сообщения ("+", "salam") и так отсеет модель через is_listing, но
// гонять на них Groq — пустой перевод квоты. Тот же порог, что и в bot.js.
const MIN_TEXT_LENGTH = 15;

async function handleMessage(client, message) {
  const text = String(message.message || '').trim();
  const hasPhoto = Boolean(message.photo);
  console.log(
    `[источник] сообщение ${message.id}: ${hasPhoto ? 'фото' : `текст (${text.length} симв.)`} — "${text.slice(0, 60)}"`
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

      const filtered = FORCE_ALL
        ? listings.filter((p) => p.is_listing && p.listing_type !== 'other')
        : listings.filter((p) => p.is_listing && FORCE_TYPES.includes(p.listing_type));

      if (!filtered.length) {
        console.log(`[источник] после фильтра "${FORCE_TYPES.join(',')}" не осталось ни одного — не публикую`);
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

// Что уже видели: ключ — источник как он записан в SOURCE_CHANNEL, значение —
// id последнего разобранного сообщения. Живёт в памяти: после перезапуска
// отсчёт начинается заново от самого свежего поста, и старое не переезжает на
// сайт повторно — при рестарте на Render это как раз то, что нужно.
const lastSeen = new Map();

async function pollSource(client, source) {
  const since = lastSeen.get(source);
  // Без точки отсчёта опрашивать нельзя: с reverse и пустым minId Telegram
  // отдаст начало истории группы, и всё это уедет на сайт как «новое».
  // Пробуем взять точку заново — источник мог быть недоступен на старте.
  if (!since) {
    const [latest] = await client.getMessages(source, { limit: 1 });
    if (latest) {
      lastSeen.set(source, latest.id);
      console.log(`[источник] ${source}: точка отсчёта восстановлена на ${latest.id}`);
    }
    return;
  }

  // minId с reverse работает как offsetId и не включает само сообщение, так
  // что своё же последнее второй раз не придёт. reverse — чтобы разбирать в
  // порядке публикации.
  const messages = await client.getMessages(source, {
    limit: BATCH,
    minId: since,
    reverse: true,
  });

  if (!messages.length) return;

  console.log(`[источник] ${source}: новых сообщений ${messages.length}`);
  for (const message of messages) {
    lastSeen.set(source, Math.max(lastSeen.get(source) || 0, message.id));
    await handleMessage(client, message);
  }
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

  client = new TelegramClient(new StringSession(SESSION_STRING), API_ID, API_HASH, {
    connectionRetries: 5,
  });
  await client.connect();

  // Точка отсчёта — самый свежий пост на момент запуска. Без неё первый же
  // опрос вытащил бы всю доступную историю группы и попытался опубликовать её
  // целиком.
  for (const source of SOURCES) {
    try {
      const [latest] = await client.getMessages(source, { limit: 1 });
      if (latest) lastSeen.set(source, latest.id);
      console.log(`[источник] ${source}: старт с сообщения ${latest ? latest.id : '—'}`);
    } catch (err) {
      console.error(`[источник] не смог открыть "${source}": ${err.message}`);
    }
  }

  // Опрос по кругу, а не setInterval: пока идёт разбор, следующий заход не
  // стартует и запросы не накладываются друг на друга.
  const loop = async () => {
    for (const source of SOURCES) {
      try {
        await pollSource(client, source);
      } catch (err) {
        console.error(`[источник] опрос "${source}":`, err.message);
      }
    }
    setTimeout(loop, POLL_MS);
  };
  setTimeout(loop, POLL_MS);

  console.log(
    `Автоимпорт из канала включён: ${SOURCES.join(', ')} → только ${FORCE_TYPE === 'all' ? 'все объявления' : FORCE_TYPE}, опрос раз в ${POLL_MS / 1000} с`
  );
}

module.exports = { start, isConfigured };

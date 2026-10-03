// Автоимпорт вакансий из чужого Telegram-канала — без пересылки руками.
//
// Бот из bot.js видит только то, что ему прислали лично, — пересланное
// сообщение. Канал-источник — чужой (админ там просто подписчик),
// а Bot API не даёт читать посты в канале, где бот не администратор. Поэтому
// здесь не бот, а юзер-сессия (MTProto, библиотека GramJS) — то же самое, что
// открытый Telegram на телефоне админа, только без интерфейса. Она читает
// новые посты и сама отдаёт их в тот же разбор и ту же публикацию, которыми
// идут объявления из личных сообщений (bot.ingestFromSource = handleParsed из
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
const tg = require('./api');
const queue = require('./queue');
const bot = require('./bot');
const feedStats = require('./feedStats');
const blocklist = require('./blocklist');
const rejected = require('./rejected');
const adGroups = require('./adGroups');
const spam = require('../spam');
const { ADMIN_IDS } = require('./notify');

const API_ID = Number(process.env.TELEGRAM_API_ID || 0);
const API_HASH = process.env.TELEGRAM_API_HASH || '';
const SESSION_STRING = process.env.TELEGRAM_SESSION_STRING || '';

// Один или несколько каналов через запятую: @username или числовой id.
const SOURCES = String(process.env.SOURCE_CHANNEL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Что публикуем из источников. По умолчанию всё, кроме явного мусора
// (listing_type = other), и это важнее, чем кажется: фильтр стоит ПОСЛЕ модели,
// то есть за отброшенный тип разбор уже оплачен из суточной нормы токенов.
// Раньше здесь стояло vacancy,order, и каждое объявление с доски —
// «продаю», «сдаю», «делаем ремонт», реклама курсов — выбрасывалось уже
// разобранным. Список через запятую (vacancy,order,board) сужает обратно.
const FORCE_TYPES = String(process.env.SOURCE_LISTING_TYPE || 'all')
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

// Сколько часов объявление ещё имеет смысл публиковать. По длине очередь не
// обрезаем: вакансия, написанная утром, вечером всё ещё живая, и выбрасывать её
// только потому, что перед ней в очереди много других, — потеря на ровном
// месте, она бы дождалась. Смотрим не на очередь, а на дату самого поста, и
// проверяем перед разбором, а не при приёме: пока пост стоял в очереди, он мог
// и протухнуть.
//
// Это же страхует от бесконечного роста очереди. Бесплатный Groq пропускает
// около двух разборов в минуту на ключ; если из групп приходит
// больше, отставание упирается в этот порог и дальше не растёт — протухшая
// голова очереди отбрасывается мгновенно, без запроса к модели.
const MAX_AGE_MS = Number(process.env.SOURCE_MAX_AGE_HOURS || 12) * 3600 * 1000;

// Пост с несколькими фотографиями Telegram присылает несколькими сообщениями с
// общим grouped_id, и текст объявления стоит только у первого. Разбирать
// остальные — это и лишние вызовы Groq, и три одинаковые карточки на сайте
// вместо одной.
const seenGroups = new Set();

function firstInAlbum(message) {
  if (!message.groupedId) return true;
  const group = String(message.groupedId);
  if (seenGroups.has(group)) return false;
  seenGroups.add(group);
  // Альбомы приходят подряд, поэтому помним только последние ключи.
  if (seenGroups.size > 200) seenGroups.delete(seenGroups.values().next().value);
  return true;
}

// Одно и то же объявление автор рассылает в десяток групп разом и повторяет
// через пару часов. Карточку-дубль отсекает и imports.create (телефон плюс
// заголовок за час), но уже после модели — то есть каждый повтор стоил разбора
// из суточной нормы. Здесь повтор узнаём по самому тексту, до модели: буквы и
// цифры без эмодзи и пробелов. Живёт в памяти — после перезапуска первый
// повтор разберётся ещё раз, и это дёшево.
const DEDUP_MS = Number(process.env.SOURCE_DEDUP_HOURS || 12) * 3600 * 1000;
const DEDUP_MAX = 3000;
const seenTexts = new Map();

function textKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 400);
}

// true — такой текст уже был недавно. Заодно запоминает новый.
function repeated(text, now = Date.now()) {
  const key = textKey(text);
  if (!key) return false;
  const at = seenTexts.get(key);
  if (at && now - at < DEDUP_MS) return true;
  seenTexts.delete(key);
  seenTexts.set(key, now);
  // Map помнит порядок вставки — самые старые ключи в начале.
  while (seenTexts.size > DEDUP_MAX) seenTexts.delete(seenTexts.keys().next().value);
  return false;
}

// Разбор не удался (лимит модели, пост устарел в очереди) — текст забываем:
// автор повторит его вечером, когда лимит отпустит, и повтор должен дойти до
// модели, а не отсеяться как уже виденный.
function forget(text) {
  seenTexts.delete(textKey(text));
}

// Номер для чёрного списка — только если он в посте один. Второй номер почти
// всегда контакт самой группы («по рекламе: …»), и с ним замолчала бы вся
// группа на месяц.
function soleNumber(text) {
  const phones = blocklist.phonesIn(text);
  return phones.length === 1 ? phones : [];
}

// Про упёршийся суточный лимит бот молчал: ошибка фоновой задачи уходила в лог
// Render, а в чате в это время было пусто — и «в группах ничего не пишут» ничем
// не отличалось от «мы стоим до утра». Говорим один раз в сутки: повторять на
// каждом посте незачем, их за остаток дня наберутся десятки.
let limitNotedOn = null;

async function noteLimit(err) {
  const day = new Date().toISOString().slice(0, 10);
  if (!err.rateLimited || limitNotedOn === day) return;
  limitNotedOn = day;
  // По Бишкеку, а не по UTC, в котором живёт Render: иначе бот обещает
  // освобождение вчерашним вечером, когда на часах у админа час ночи.
  const until = err.retryAt
    ? new Date(err.retryAt).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' })
    : null;
  await tg
    .sendMessage(
      REPORT_CHAT_ID,
      [
        '🧠 Суточная норма разбора выбрана на всех моделях, кроме резервной, — объявления из групп пока не публикуются.',
        'Резервная модель бережётся под рекламу: /ad по-прежнему разбирается.',
        until ? `Освободится к ${until}.` : 'Когда отпустит, Groq не сказал.',
        'Проверить расход: /stats',
      ].join('\n')
    )
    .catch(() => {});
}

// Остальные отказы молчали точно так же, и хуже того — сами они не проходят.
// Groq снял модель, и шесть часов из групп не выходило ничего, а в чате было
// пусто: узнали только по своему же объявлению. Говорим сразу, но не на каждый
// пост — пока ошибка повторяется, напоминаем не чаще раза в час.
const FAILURE_NOTE_MS = 60 * 60 * 1000;
let failureNotedAt = 0;

async function noteFailure(err) {
  if (err.rateLimited || Date.now() - failureNotedAt < FAILURE_NOTE_MS) return;
  failureNotedAt = Date.now();
  await tg
    .sendMessage(
      REPORT_CHAT_ID,
      [
        `⚠️ Объявление из группы не вышло: ${tg.esc(err.message)}`,
        'Если ошибка не случайная, из групп сейчас не публикуется ничего. Пока она повторяется, напомню не чаще раза в час.',
      ].join('\n')
    )
    .catch(() => {});
}

async function handleMessage(message) {
  const text = String(message.message || '').trim();
  console.log(
    `[источник] сообщение ${message.id}: ${text.length} симв.${message.photo ? ' + фото' : ''} — "${text.slice(0, 60)}"`
  );

  // Наша же реклама в группе (см. adGroups.js): разбирать её как вакансию —
  // это дубль на сайте, а то и номер рекламодателя в чёрном списке.
  if (adGroups.isOwn(message)) {
    console.log('[источник] это наше сообщение — пропускаю');
    return;
  }

  if (!firstInAlbum(message)) {
    console.log('[источник] ещё одна картинка того же поста — пропускаю');
    return;
  }

  // Картинки мы больше не читаем (см. шапку extract.js) — значит, у поста
  // должен быть текст: сам пост или подпись под фотографией. Пост, у которого
  // объявление нарисовано на картинке, теперь проходит мимо, и это осознанный
  // размен: такие в этих группах редки, а стоила каждая картинка вдвое дороже
  // разбора текста.
  if (text.length < MIN_TEXT_LENGTH) {
    console.log('[источник] текста нет или он короче порога — пропускаю');
    return;
  }

  // Без телефона объявление всё равно не опубликуется (откликнуться некуда —
  // см. handleParsed в bot.js), так что разбирать его незачем.
  if (!extract.hasPhone(text)) {
    console.log('[источник] нет телефона — публиковать было бы нечего, пропускаю без разбора');
    return;
  }

  // Номер уже попадался на мусоре (см. blocklist.js) — дальше не смотрим.
  const blocked = await blocklist.blockedIn(text).catch(() => null);
  if (blocked) {
    console.log(`[источник] номер ${blocked} в чёрном списке — пропускаю без разбора`);
    feedStats.bump('grp.blocked');
    rejected.add({ text, reason: `номер ${blocked} в чёрном списке`, phones: [blocked] });
    return;
  }

  // Сетевой найм и оформление на чужие документы — по словам, до модели (см.
  // spam.js): и норму бережём, и запасные модели лесенки такое пропускают.
  // Номер запоминаем: завтра тот же вербовщик напишет другими словами.
  const junk = spam.check(text);
  if (junk) {
    console.log(`[источник] отсеял по словам: ${spam.describe(junk)}`);
    feedStats.bump(`grp.no.${junk.kind}`);
    rejected.add({ text, reason: spam.describe(junk), phones: soleNumber(text) });
    blocklist
      .add(soleNumber(text), spam.describe(junk))
      .catch((err) => console.error('[чёрный список] не записал:', err.message));
    return;
  }

  if (repeated(text)) {
    console.log('[источник] этот текст уже был в последние часы — пропускаю без разбора');
    feedStats.bump('grp.dup');
    return;
  }

  // В общую очередь разбора (backend/src/telegram/queue.js) — она же держит
  // темп для объявлений из личных сообщений и не даёт улететь в лимит Groq,
  // если из канала и от админа прилетело одновременно. Фоном: то, что админ
  // прислал руками, должно обгонять поток из чужих групп.
  queue.add(async () => {
    try {
      // Пока пост стоял в очереди, перед ним разбирались другие — мог и
      // устареть. Дата у Telegram в секундах; если её нет, считаем свежим.
      const postedAt = Number(message.date || 0) * 1000;
      const ageMs = postedAt ? Date.now() - postedAt : 0;
      if (ageMs > MAX_AGE_MS) {
        console.log(
          `[источник] сообщение ${message.id} пролежало ${Math.round(ageMs / 3600000)} ч — уже неактуально, не разбираю`
        );
        feedStats.bump('grp.stale');
        forget(text);
        return;
      }

      // background — посты из чужих групп. Последнюю, резервную модель лесенки
      // они не трогают: она отложена под рекламу (см. modelsFor в extract.js).
      const listings = await extract.fromText(text, { background: true });

      console.log(
        `[источник] Groq разобрал: ${listings
          .map((p) => `is_listing=${p.is_listing} type=${p.listing_type}`)
          .join('; ') || 'пусто'}`
      );

      const filtered = FORCE_ALL
        ? listings.filter((p) => p.is_listing && p.listing_type !== 'other')
        : listings.filter((p) => p.is_listing && FORCE_TYPES.includes(p.listing_type));

      // Что модель (или проверка по словам после неё) не взяла — в сводку, по
      // причинам. Сетевой найм, пойманный после модели, ещё и в чёрный список.
      for (const p of listings.filter((item) => !filtered.includes(item))) {
        const reason = feedStats.reasonOf(p);
        feedStats.bump(`grp.no.${reason}`);
        // Отказы «по делу» — в /spam: их модель и слова путают чаще всего.
        // Обычный шум («не объявление») туда не идёт — его слишком много.
        if (['mlm', 'drop', 'recruit'].includes(reason)) {
          rejected.add({ text, reason: p.note || reason, phones: p.spam ? soleNumber(text) : [] });
        }
        if (p.spam) {
          blocklist
            .add(soleNumber(text), p.note)
            .catch((err) => console.error('[чёрный список] не записал:', err.message));
        }
      }

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
      forget(text);
      await noteLimit(err);
      await noteFailure(err);
    }
  }, { background: true });
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
    await handleMessage(message);
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

  // Тем же аккаунтом (или отдельным, см. TELEGRAM_AD_SESSION_STRING) реклама
  // уходит в эти группы. Своим ходом: опрос не должен ждать, пока он поднимется.
  adGroups
    .start(client, { apiId: API_ID, apiHash: API_HASH })
    .catch((err) => console.error('[группы] не запустилась рассылка:', err.message));

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
    `Автоимпорт из канала включён: ${SOURCES.join(', ')} → ${FORCE_ALL ? 'все объявления' : `только ${FORCE_TYPES.join(', ')}`}, опрос раз в ${POLL_MS / 1000} с, объявления не старше ${MAX_AGE_MS / 3600000} ч`
  );
}

module.exports = { start, isConfigured, handleMessage, repeated };

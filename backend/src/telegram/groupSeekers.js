// Ответ в Telegram-группе тому, кто ищет работу.
//
// 7–8 ноября 2026 в нашей группе @Shabashkacom люди спрашивали сами: «Азыркыга
// шабашка барбы ночьго?» (есть шабашка на ночь?), «Эртенкиге шабашка барбы эки
// балабыз…» (на завтра есть? нас двое) — и никто не отвечал, хотя свежая
// подработка лежала на сайте. Это самый горячий момент: человек прямо сейчас
// хочет работу. Бот отвечает ему на сообщение тремя свежими заказами за сутки и
// двумя кнопками: «вся подработка» на сайте и «получать вакансии» в боте.
//
// Отвечаем осторожно, чтобы не засорять группу:
//  • только на вопрос ищущего — объявление работодателя («нужны 10 парней»,
//    «бала керек», «оплата 1500 сом») не трогаем;
//  • только в нашей группе (TELEGRAM_CHANNEL_ID), не ботам и не на ответы в
//    чужом разговоре;
//  • одному человеку — не чаще раза в 6 часов, всей группе — раз в 3 минуты:
//    свежий ответ и так висит прямо над следующим вопросом.
// Счётчики — в памяти: перезапуск Render их обнулит, и это не страшно — худшее,
// что будет, это ещё один ответ.
const feedStats = require('./feedStats');
const { money } = require('../money');
const { tag } = require('../sourceTag');

const USER_GAP_MS = 6 * 60 * 60 * 1000;
const CHAT_GAP_MS = 3 * 60 * 1000;
const MAX_LENGTH = 200;
const LIMIT = 3;

// \b в JavaScript кириллицу не понимает, поэтому границы слова — через \p{L}.
const word = (body) => new RegExp(`(?<!\\p{L})(?:${body})(?!\\p{L})`, 'iu');

// Что ищут: шабашка, подработка, работа, иш, жумуш — в нужных падежах.
const WORK = 'шабашк[аиуе]|подработк[аиуе]|работ[аыуе]|иш|жумуш';
const SEEKER = [
  // «шабашка барбы», «иш барбы?», «жумуш барбы эртеңкиге»
  word(`(?:${WORK})(?:\\s+\\p{L}+){0,2}\\s+бар\\s*(?:бы|ма)`),
  // «барбы шабашка»
  word(`бар\\s*(?:бы|ма)(?:\\s+\\p{L}+){0,2}\\s+(?:${WORK})`),
  // «есть работа», «есть ли подработка», «есть какая-нибудь шабашка»
  word(`есть\\s+(?:ли\\s+)?(?:\\p{L}+[-\\s]\\p{L}+\\s+|\\p{L}+\\s+)?(?:${WORK})`),
  // «ищу работу», «ищу любую подработку», «ищем работу», «нужна работа»
  word('(?:ищу|ищем|нужна)\\s+(?:\\p{L}+\\s+)?(?:работу|работа|подработку|подработка|шабашку|шабашка)'),
  // «иш издеп жатам», «жумуш издейм»
  word('(?:иш|жумуш)\\s+изде\\p{L}*'),
  // «иш керек», «жумуш керек эле»
  word('(?:иш|жумуш|шабашка)\\s+керек'),
  // «работа есть?», «подработка нужна», «шабашка нужна»
  word('(?:работа|подработка|шабашка)\\s+(?:есть\\s*\\?|нужна)'),
];

// Так пишет работодатель. Слова поиска в его объявлении тоже бывают («работа
// есть, звоните»), поэтому эти признаки сильнее.
const EMPLOYER = [
  word('требу[ею]тся|нужны|нужен|набира[ею]м|приглаша[ею]м|вакансия|оплата|зарплата|зп|айлык|төлөйбүз'),
  word('ищем\\s+(?:работник\\p{L}*|сотрудник\\p{L}*|рабоч\\p{L}*|грузчик\\p{L}*|девуш\\p{L}*|парн\\p{L}*)'),
  word('(?:бала|балдар|кыз|кыздар|киши|адам|адамдар|жумушчу|жумушчулар|уста)\\s+керек'),
  // «шабашка бар», «работа есть, звоните» — но не «шабашка барбы?», «работа есть?»
  word('(?:шабашка|иш|жумуш)\\s+бар(?!\\s*(?:бы|ма))|работа\\s+есть(?!\\s*\\?)'),
  /\d[\d\s]*\s*сом/iu,
];

function isSeeker(text) {
  const t = String(text || '').trim();
  if (!t || t.length > MAX_LENGTH || t.startsWith('/')) return false;
  if (EMPLOYER.some((re) => re.test(t))) return false;
  return SEEKER.some((re) => re.test(t));
}

// Кыргызские буквы или слова — отвечаем кыргызской шапкой.
const KYRGYZ = [/[ңөү]/iu, word('барбы|бар\\s+бы|керек|иш|жумуш|балабыз|балдар|эртеңки\\p{L}*|эртенки\\p{L}*|азыркы\\p{L}*')];
const isKyrgyz = (text) => KYRGYZ.some((re) => re.test(String(text || '')));

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let lastByUser = new Map();
let lastInChat = 0;
function reset() {
  lastByUser = new Map();
  lastInChat = 0;
}

// Наша ли это группа: TELEGRAM_CHANNEL_ID бывает числом (-100…) или именем (@…).
function ours(chat, groupId) {
  const id = String(groupId || '').trim();
  if (!id || !chat) return false;
  if (id.startsWith('@')) return String(chat.username || '').toLowerCase() === id.slice(1).toLowerCase();
  return String(chat.id) === id;
}

function render(orders, { siteUrl, pretty }, kyrgyz) {
  const link = (id) => pretty(tag(`${siteUrl}/orders/${id}`, 'telegram'));
  const lines = orders.map(({ id, parsed }, i) => {
    const where = [parsed.budget ? `${money(parsed.budget)} сом` : '', parsed.city].filter(Boolean).join(', ');
    return `${i + 1}. ${esc(parsed.title)}${where ? ` — ${esc(where)}` : ''}\n${link(id)}`;
  });
  const head = kyrgyz ? '👷 Бүгүнкү шабашкалар — Свежая подработка:' : '👷 Свежая подработка за сутки:';
  const empty = 'Новые заказы появляются каждый день — смотрите «🧰 Вся подработка» 👇';
  const tail = kyrgyz
    ? 'Жаңы вакансиялар өзүңүзгө Telegram\'га келип турсун — «🔔 Получать вакансии» баскычын басыңыз 👇'
    : '🔔 Чтобы новые вакансии приходили вам сами — нажмите «Получать вакансии» 👇';
  const body = lines.length ? [head, ...lines] : [empty];
  return [...body, '', tail].join('\n');
}

// Сообщение в группе. true — ответили. deps: groupId, siteUrl, pretty(url),
// send(chatId, html, extra), load({ hours, limit }) → свежие заказы.
async function onMessage(message, deps, now = Date.now()) {
  if (!message || !message.chat || !['group', 'supergroup'].includes(message.chat.type)) return false;
  if (!ours(message.chat, deps.groupId) || !deps.siteUrl) return false;
  if (!message.from || message.from.is_bot || message.reply_to_message || message.forward_origin) return false;
  if (!isSeeker(message.text)) return false;

  const user = message.from.id;
  if (now - (lastByUser.get(user) || -Infinity) < USER_GAP_MS) return false;
  if (now - lastInChat < CHAT_GAP_MS) return false;

  // Отметки ставим до похода в базу: на вебхуке апдейты разбираются
  // одновременно, и второй вопрос, пришедший, пока грузятся заказы, иначе тоже
  // получил бы ответ. База не ответила — отметки возвращаем как были.
  const before = { user: lastByUser.get(user), chat: lastInChat };
  // Старые отметки выбрасываем, чтобы список не рос месяцами.
  if (lastByUser.size > 500) {
    for (const [id, at] of lastByUser) if (now - at >= USER_GAP_MS) lastByUser.delete(id);
  }
  lastByUser.set(user, now);
  lastInChat = now;

  let orders;
  try {
    orders = await (deps.load || defaultLoad)({ hours: 24, limit: LIMIT });
  } catch (err) {
    console.error('[группа] свежие заказы для ответа:', err.message);
    if (before.user === undefined) lastByUser.delete(user);
    else lastByUser.set(user, before.user);
    lastInChat = before.chat;
    return false;
  }

  const rows = [
    [{ text: '🧰 Вся подработка', url: tag(`${deps.siteUrl}/orders`, 'telegram') }],
    [{ text: '🔔 Получать вакансии', url: `${deps.siteUrl}/s/menu/telegram` }],
  ];
  await deps.send(message.chat.id, render((orders || []).slice(0, LIMIT), deps, isKyrgyz(message.text)), {
    reply_to_message_id: message.message_id,
    allow_sending_without_reply: true,
    reply_markup: { inline_keyboard: rows },
  });
  await feedStats.bump('group.seeker').catch(() => {});
  return true;
}

// Свежие заказы из базы — лениво, чтобы модуль грузился и без неё.
const defaultLoad = (opts) => require('../rubricsRepo').freshOrders(opts);

module.exports = { onMessage, isSeeker, isKyrgyz, reset };

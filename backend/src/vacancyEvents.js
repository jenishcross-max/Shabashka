// Новая вакансия с сайта — повод для бота разослать её в Telegram-группу, Threads
// и Instagram (см. telegram/siteShare.js). Роут вакансий о боте не знает: он только
// сообщает сюда, а слушателя вешает бот при запуске — как у задач биржи (см.
// taskEvents.js). Без бота (тесты, запуск без токена) сообщать просто некому.
let listener = null;

function onCreated(fn) {
  listener = fn;
}

// Сбой бота не должен ронять размещение вакансии — она уже в базе.
function created(vacancy, author) {
  if (!listener) return;
  Promise.resolve()
    .then(() => listener(vacancy, author))
    .catch((err) => console.error('[вакансии с сайта] не сообщил о вакансии:', err.message));
}

module.exports = { onCreated, created };

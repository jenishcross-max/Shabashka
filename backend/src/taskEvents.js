// Новая задача на бирже — повод для бота: показать её админу и, с его
// согласия, раздать в Threads, Telegram-канал и подписчикам (см.
// telegram/taskShare.js). Роут биржи о боте не знает: он только сообщает
// сюда, а слушателя вешает бот при запуске. Без бота (тесты, локальный
// запуск без токена) сообщать просто некому.
let listener = null;

function onCreated(fn) {
  listener = fn;
}

// Сбой бота не должен ронять размещение задачи — она уже в базе.
function created(task) {
  if (!listener) return;
  Promise.resolve()
    .then(() => listener(task))
    .catch((err) => console.error('[биржа] не сообщил о задаче:', err.message));
}

module.exports = { onCreated, created };

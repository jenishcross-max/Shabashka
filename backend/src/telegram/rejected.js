// Последние посты из групп, отсеянные как мусор: сетевой найм, оформление на
// чужие документы, вербовка, номер из чёрного списка.
//
// Фильтр по словам (см. spam.js) и модель иногда ошибаются, а посты из групп
// бот публикует молча — ошибку не увидит никто, кроме сводки, где она одна
// цифра среди десятков. Поэтому отсеянное держим здесь, а /spam в боте
// показывает его с кнопкой «✅ Не спам»: номер уходит из чёрного списка, а
// пост — на разбор заново.
//
// В памяти: после перезапуска список пуст, и это нормально — смотреть его
// нужно в тот же день, вчерашний пост уже не опубликуешь.

const MAX = 30;
const items = [];
let seq = 0;

// { text, reason, phones } → id записи.
function add({ text, reason, phones = [] }) {
  const id = String((seq += 1));
  items.unshift({ id, text: String(text || ''), reason: String(reason || ''), phones: [...phones], at: Date.now() });
  if (items.length > MAX) items.length = MAX;
  return id;
}

const list = (limit = 10) => items.slice(0, limit);

// Достать запись и убрать из списка: второй раз по той же кнопке разбирать
// незачем.
function take(id) {
  const i = items.findIndex((item) => item.id === String(id));
  return i === -1 ? null : items.splice(i, 1)[0];
}

module.exports = { add, list, take, MAX };

import { plural } from './plural';

// Подписи биржи услуг в одном месте: лента, страница задачи и «Моё на бирже»
// должны называть одно и то же одинаково. Состояния откликов приходят словом с
// сервера (см. backend/src/exchange.js, offerState) — здесь только их подписи.

export const TASK_STATUS_LABELS = {
  open: 'Открыта',
  assigned: 'Исполнитель выбран',
  done: 'Выполнена',
  cancelled: 'Отменена',
};

export const OFFER_STATE_LABELS = {
  waiting: 'Ждёт решения',
  chosen: 'Вас выбрали',
  done: 'Выполнено',
  other: 'Выбран другой',
  cancelled: 'Задача отменена',
  withdrawn: 'Отозван',
  dropped: 'Выбор отменён',
  removed: 'Снят модератором',
};

// Значок статуса: зелёный — с задачей ещё можно что-то делать, красный — всё.
export function statusClass(status) {
  return status === 'open' || status === 'assigned' ? 'status-open' : 'status-closed';
}

export function som(n) {
  return `${Number(n).toLocaleString('ru-RU')} сом`;
}

// Бюджет задачи — ориентир заказчика; без него цену называют исполнители.
export function taskBudget(task) {
  return task.budget ? `до ${som(task.budget)}` : 'Цену предложат исполнители';
}

// «с марта 2026». toLocaleDateString даёт месяц в именительном падеже («с март»),
// поэтому родительный — своим списком.
const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

export function sinceMonth(iso) {
  const date = new Date(iso);
  return `с ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// То, по чему заказчик выбирает, пока отзывов нет. Без «выполнил/выполнила»:
// пол исполнителя нам неизвестен.
export function trustLine(offer) {
  const done =
    offer.done_count > 0
      ? `${offer.done_count} ${plural(offer.done_count, 'задача выполнена', 'задачи выполнены', 'задач выполнено')} на бирже`
      : 'Новичок на бирже';
  return `${done} · на сайте ${sinceMonth(offer.user_since)}`;
}

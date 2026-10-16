import { request } from './client';
import { PAGE_SIZE } from './paging';

// Биржа услуг: /api/tasks (описание — README, раздел «Биржа услуг»).
export const listTasks = ({ q, category, city, page = 1 } = {}) =>
  request('/tasks', { query: { q, category, city, page, limit: PAGE_SIZE } });

export const getTask = (id) => request(`/tasks/${id}`);

// Отклики целиком видит только заказчик; открытие списка помечает их увиденными.
export const listOffers = (id) => request(`/tasks/${id}/offers`);

// Один адрес и на новый отклик, и на правку. Цену шлём как набрали — «2 000» и
// «2000» сервер разбирает одинаково (backend/src/exchange.js, toPrice).
export const saveOffer = (id, { price, term, comment }) =>
  request(`/tasks/${id}/offers`, { method: 'POST', body: { price, term, comment } });
export const withdrawOffer = (id) => request(`/tasks/${id}/offers/withdraw`, { method: 'POST' });

// Действия заказчика. Выбор открывает переписку — в ответе её conversation_id.
export const acceptOffer = (id, offerId) => request(`/tasks/${id}/offers/${offerId}/accept`, { method: 'POST' });
export const cancelTask = (id) => request(`/tasks/${id}/cancel`, { method: 'POST' });
export const doneTask = (id) => request(`/tasks/${id}/done`, { method: 'POST' });
export const unassignTask = (id) => request(`/tasks/${id}/unassign`, { method: 'POST' });

// Жалобы: на задачу — от всех и без входа, на отклик — только от заказчика.
export const reportTask = (id, reason) => request(`/tasks/${id}/report`, { method: 'POST', body: { reason } });
export const reportOffer = (id, offerId, reason) =>
  request(`/tasks/${id}/offers/${offerId}/report`, { method: 'POST', body: { reason } });

// Разместить и изменить задачу; ответ — { task }. Проверяет поля сервер.
export const createTask = (fields) => request('/tasks', { method: 'POST', body: fields });
export const updateTask = (id, fields) => request(`/tasks/${id}`, { method: 'PATCH', body: fields });

// «Моё на бирже»: мои задачи (с new_offers — сколько откликов я ещё не видел)
// и мои отклики (с state и названием задачи).
export const myTasks = () => request('/tasks/mine');
export const myOffers = () => request('/tasks/my-offers');

import { request } from './client';
import { PAGE_SIZE } from './paging';

// Биржа услуг: /api/tasks (описание — README, раздел «Биржа услуг»).
export const listTasks = ({ q, category, city, page = 1 } = {}) =>
  request('/tasks', { query: { q, category, city, page, limit: PAGE_SIZE } });

export const getTask = (id) => request(`/tasks/${id}`);

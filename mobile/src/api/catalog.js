import { request } from './client';

// Категории общие для заказов и биржи: сервер проверяет задачу по этому же списку.
// format ('online' | 'offline') — только подходящие формату; без него — все (фильтр ленты).
export const listCategories = (format) => request('/orders/categories', { query: { format } });

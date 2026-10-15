import { request } from './client';

// Категории общие для заказов и биржи: сервер проверяет задачу по этому же списку.
export const listCategories = () => request('/orders/categories');

const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    throw new Error(data?.error || 'Что-то пошло не так');
  }
  return data;
}

function toQueryString(params) {
  const normalized = Object.entries(params)
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v])
    .filter(([, v]) => v !== '' && v !== null && v !== undefined && v !== false);
  const qs = new URLSearchParams(normalized).toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: (token) => request('/auth/me', { token }),

  home: () => request('/home'),
  categories: (format) => request(`/orders/categories${format ? `?format=${format}` : ''}`),
  categoryCounts: () => request('/orders/category-counts'),
  cityCounts: () => request('/orders/city-counts'),
  publicStats: () => request('/orders/public-stats'),
  cities: () => request('/orders/cities'),
  orders: (params = {}) => request(`/orders${toQueryString(params)}`),
  order: (id) => request(`/orders/${id}`),
  similarOrders: (id) => request(`/orders/${id}/similar`),
  ordersBatch: (ids) => request(`/orders/batch?ids=${ids.join(',')}`),
  myOrders: (token) => request('/orders/mine', { token }),
  createOrder: (payload, token) => request('/orders', { method: 'POST', body: payload, token }),
  updateOrder: (id, payload, token) => request(`/orders/${id}`, { method: 'PATCH', body: payload, token }),
  setOrderStatus: (id, status, token) =>
    request(`/orders/${id}`, { method: 'PATCH', body: { status }, token }),
  deleteOrder: (id, token) => request(`/orders/${id}`, { method: 'DELETE', token }),
  reportOrder: (id, reason) => request(`/orders/${id}/report`, { method: 'POST', body: { reason } }),

  employmentTypes: () => request('/vacancies/employment-types'),
  experienceLevels: () => request('/vacancies/experience-levels'),
  vacancyCategoryCounts: () => request('/vacancies/category-counts'),
  vacancies: (params = {}) => request(`/vacancies${toQueryString(params)}`),
  vacancy: (id) => request(`/vacancies/${id}`),
  vacanciesBatch: (ids) => request(`/vacancies/batch?ids=${ids.join(',')}`),
  myVacancies: (token) => request('/vacancies/mine', { token }),
  createVacancy: (payload, token) => request('/vacancies', { method: 'POST', body: payload, token }),
  updateVacancy: (id, payload, token) =>
    request(`/vacancies/${id}`, { method: 'PATCH', body: payload, token }),
  setVacancyStatus: (id, status, token) =>
    request(`/vacancies/${id}`, { method: 'PATCH', body: { status }, token }),
  deleteVacancy: (id, token) => request(`/vacancies/${id}`, { method: 'DELETE', token }),

  conversations: (token) => request('/conversations', { token }),
  conversation: (id, token) => request(`/conversations/${id}`, { token }),
  unreadCount: (token) => request('/conversations/unread-count', { token }),
  startVacancyConversation: (vacancyId, message, token) =>
    request('/conversations', { method: 'POST', body: { vacancyId, message }, token }),
  startOrderConversation: (orderId, message, token) =>
    request('/conversations', { method: 'POST', body: { orderId, message }, token }),
  sendMessage: (id, body, token) =>
    request(`/conversations/${id}/messages`, { method: 'POST', body: { body }, token }),

  adminStats: (token) => request('/admin/stats', { token }),
  adminUsers: (token) => request('/admin/users', { token }),
  adminSetUserBlocked: (id, blocked, token) =>
    request(`/admin/users/${id}`, { method: 'PATCH', body: { blocked }, token }),
  adminOrders: (token) => request('/admin/orders', { token }),
  adminSetOrderStatus: (id, status, token) =>
    request(`/admin/orders/${id}`, { method: 'PATCH', body: { status }, token }),
  adminSetOrderPinned: (id, pinned, token) =>
    request(`/admin/orders/${id}`, { method: 'PATCH', body: { pinned }, token }),
  adminVacancies: (token) => request('/admin/vacancies', { token }),
  adminSetVacancyStatus: (id, status, token) =>
    request(`/admin/vacancies/${id}`, { method: 'PATCH', body: { status }, token }),
  adminSetVacancyPinned: (id, pinned, token) =>
    request(`/admin/vacancies/${id}`, { method: 'PATCH', body: { pinned }, token }),
  adminReports: (token, status = 'open') => request(`/admin/reports?status=${status}`, { token }),
  adminResolveReport: (id, action, token) =>
    request(`/admin/reports/${id}`, { method: 'PATCH', body: { action }, token }),
  adminCategories: (token) => request('/admin/categories', { token }),
  adminAddCategory: (name, token) =>
    request('/admin/categories', { method: 'POST', body: { name }, token }),
  adminRemoveCategory: (id, token) => request(`/admin/categories/${id}`, { method: 'DELETE', token }),
};

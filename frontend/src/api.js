const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

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

export const api = {
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: (token) => request('/auth/me', { token }),

  categories: () => request('/orders/categories'),
  categoryCounts: () => request('/orders/category-counts'),
  orders: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/orders${qs ? `?${qs}` : ''}`);
  },
  order: (id) => request(`/orders/${id}`),
  myOrders: (token) => request('/orders/mine', { token }),
  createOrder: (payload, token) => request('/orders', { method: 'POST', body: payload, token }),
  setOrderStatus: (id, status, token) =>
    request(`/orders/${id}`, { method: 'PATCH', body: { status }, token }),
  deleteOrder: (id, token) => request(`/orders/${id}`, { method: 'DELETE', token }),
  reportOrder: (id, reason) => request(`/orders/${id}/report`, { method: 'POST', body: { reason } }),

  adminStats: (token) => request('/admin/stats', { token }),
  adminUsers: (token) => request('/admin/users', { token }),
  adminSetUserBlocked: (id, blocked, token) =>
    request(`/admin/users/${id}`, { method: 'PATCH', body: { blocked }, token }),
  adminOrders: (token) => request('/admin/orders', { token }),
  adminSetOrderStatus: (id, status, token) =>
    request(`/admin/orders/${id}`, { method: 'PATCH', body: { status }, token }),
  adminReports: (token, status = 'open') => request(`/admin/reports?status=${status}`, { token }),
  adminResolveReport: (id, action, token) =>
    request(`/admin/reports/${id}`, { method: 'PATCH', body: { action }, token }),
};

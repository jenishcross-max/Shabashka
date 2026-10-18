const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Бэкенд живёт на бесплатном Render и после долгого простоя поднимается почти
// минуту. Пустой скелет всё это время читается как «сайт сломан», поэтому
// считаем незакрытые запросы и даём интерфейсу возможность объясниться.
let inFlight = 0;
const watchers = new Set();

export function onPendingChange(fn) {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

function track(delta) {
  inFlight += delta;
  watchers.forEach((fn) => fn(inFlight));
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  track(1);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } finally {
    track(-1);
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    throw new Error(data?.error || 'Что-то пошло не так');
  }
  return data;
}

// Фото объявления: бэкенд выдаёт одноразовую ссылку, а сам файл идёт прямо в
// Supabase Storage, мимо Render (см. backend/src/photoStorage.js). FormData с
// пустым именем поля — так грузит и официальный клиент Supabase.
export async function uploadAdPhoto(blob, token) {
  const slot = await request('/ads/photos', { method: 'POST', token });
  const form = new FormData();
  form.append('cacheControl', '31536000');
  form.append('', blob, 'photo.jpg');
  const res = await fetch(slot.upload_url, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: form });
  if (!res.ok) throw new Error('Фото не загрузилось — проверьте связь и попробуйте ещё раз');
  return { path: slot.path, url: slot.url };
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
  verifyEmail: (verifyToken) => request('/auth/verify-email', { method: 'POST', body: { token: verifyToken } }),
  resendVerification: (token) => request('/auth/resend-verification', { method: 'POST', token }),

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
  bumpOrder: (id, token) => request(`/orders/${id}/bump`, { method: 'POST', token }),

  employmentTypes: () => request('/vacancies/employment-types'),
  experienceLevels: () => request('/vacancies/experience-levels'),
  vacancyCategoryCounts: () => request('/vacancies/category-counts'),
  vacancies: (params = {}) => request(`/vacancies${toQueryString(params)}`),
  vacancy: (id) => request(`/vacancies/${id}`),
  similarVacancies: (id) => request(`/vacancies/${id}/similar`),
  // Не запрос, а адрес для кнопки: бэкенд перенаправит в Telegram-бота (см. routes/subscribe.js).
  subscribeUrl: (slug) => `${API_BASE}/subscribe/${slug}`,
  vacanciesBatch: (ids) => request(`/vacancies/batch?ids=${ids.join(',')}`),
  myVacancies: (token) => request('/vacancies/mine', { token }),
  createVacancy: (payload, token) => request('/vacancies', { method: 'POST', body: payload, token }),
  updateVacancy: (id, payload, token) =>
    request(`/vacancies/${id}`, { method: 'PATCH', body: payload, token }),
  setVacancyStatus: (id, status, token) =>
    request(`/vacancies/${id}`, { method: 'PATCH', body: { status }, token }),
  deleteVacancy: (id, token) => request(`/vacancies/${id}`, { method: 'DELETE', token }),
  reportVacancy: (id, reason) => request(`/vacancies/${id}/report`, { method: 'POST', body: { reason } }),
  bumpVacancy: (id, token) => request(`/vacancies/${id}/bump`, { method: 'POST', token }),


  conversations: (token) => request('/conversations', { token }),
  conversation: (id, token) => request(`/conversations/${id}`, { token }),
  unreadCount: (token) => request('/conversations/unread-count', { token }),
  startVacancyConversation: (vacancyId, message, token) =>
    request('/conversations', { method: 'POST', body: { vacancyId, message }, token }),
  startOrderConversation: (orderId, message, token) =>
    request('/conversations', { method: 'POST', body: { orderId, message }, token }),
  startAdConversation: (adId, message, token) =>
    request('/conversations', { method: 'POST', body: { adId, message }, token }),
  sendMessage: (id, body, token) =>
    request(`/conversations/${id}/messages`, { method: 'POST', body: { body }, token }),

  // Биржа услуг (см. backend/src/routes/tasks.js)
  tasks: (params = {}) => request(`/tasks${toQueryString(params)}`),
  task: (id, token) => request(`/tasks/${id}`, { token }),
  myTasks: (token) => request('/tasks/mine', { token }),
  myOffers: (token) => request('/tasks/my-offers', { token }),
  createTask: (payload, token) => request('/tasks', { method: 'POST', body: payload, token }),
  updateTask: (id, payload, token) => request(`/tasks/${id}`, { method: 'PATCH', body: payload, token }),
  taskStep: (id, step, token) => request(`/tasks/${id}/${step}`, { method: 'POST', token }),
  taskOffers: (id, token) => request(`/tasks/${id}/offers`, { token }),
  saveOffer: (id, payload, token) => request(`/tasks/${id}/offers`, { method: 'POST', body: payload, token }),
  withdrawOffer: (id, token) => request(`/tasks/${id}/offers/withdraw`, { method: 'POST', token }),
  acceptOffer: (id, offerId, token) =>
    request(`/tasks/${id}/offers/${offerId}/accept`, { method: 'POST', token }),
  reportTask: (id, reason) => request(`/tasks/${id}/report`, { method: 'POST', body: { reason } }),
  reportOffer: (id, offerId, reason, token) =>
    request(`/tasks/${id}/offers/${offerId}/report`, { method: 'POST', body: { reason }, token }),

  // Объявления: сдам, сниму, продам, куплю, отдам даром (см. backend/src/routes/ads.js)
  ads: (params = {}) => request(`/ads${toQueryString(params)}`),
  ad: (id, token) => request(`/ads/${id}`, { token }),
  adsBatch: (ids) => request(`/ads/batch?ids=${ids.join(',')}`),
  myAds: (token) => request('/ads/mine', { token }),
  createAd: (payload, token) => request('/ads', { method: 'POST', body: payload, token }),
  updateAd: (id, payload, token) => request(`/ads/${id}`, { method: 'PATCH', body: payload, token }),
  adStep: (id, step, token) => request(`/ads/${id}/${step}`, { method: 'POST', token }),
  deleteAd: (id, token) => request(`/ads/${id}`, { method: 'DELETE', token }),
  reportAd: (id, reason) => request(`/ads/${id}/report`, { method: 'POST', body: { reason } }),

  adminStats: (token) => request('/admin/stats', { token }),
  adminUsers: (params = {}, token) => request(`/admin/users${toQueryString(params)}`, { token }),
  adminUserDetail: (id, token) => request(`/admin/users/${id}`, { token }),
  adminSetUserBlocked: (id, blocked, token) =>
    request(`/admin/users/${id}`, { method: 'PATCH', body: { blocked }, token }),
  adminResetUserPassword: (id, token) =>
    request(`/admin/users/${id}/reset-password`, { method: 'POST', token }),
  adminOrders: (params = {}, token) => request(`/admin/orders${toQueryString(params)}`, { token }),
  adminSetOrderPinned: (id, pinned, token) =>
    request(`/admin/orders/${id}`, { method: 'PATCH', body: { pinned }, token }),
  adminDeleteOrder: (id, token) => request(`/admin/orders/${id}`, { method: 'DELETE', token }),
  adminBumpOrder: (id, token) => request(`/admin/orders/${id}/bump`, { method: 'POST', token }),
  adminVacancies: (params = {}, token) => request(`/admin/vacancies${toQueryString(params)}`, { token }),
  adminSetVacancyPinned: (id, pinned, token) =>
    request(`/admin/vacancies/${id}`, { method: 'PATCH', body: { pinned }, token }),
  adminDeleteVacancy: (id, token) => request(`/admin/vacancies/${id}`, { method: 'DELETE', token }),
  adminBumpVacancy: (id, token) => request(`/admin/vacancies/${id}/bump`, { method: 'POST', token }),
  adminReports: (token, status = 'open') => request(`/admin/reports?status=${status}`, { token }),
  adminResolveReport: (id, action, token) =>
    request(`/admin/reports/${id}`, { method: 'PATCH', body: { action }, token }),
  adminModerationLog: (token) => request('/admin/moderation-log', { token }),
  adminSpamSweep: (token) => request('/admin/spam-sweep', { token }),
  adminSpamSweepRemove: (items, token) =>
    request('/admin/spam-sweep', { method: 'POST', body: { items }, token }),
  adminBoardPosts: (params = {}, token) => request(`/admin/board${toQueryString(params)}`, { token }),
  adminSetBoardPinned: (id, pinned, token) =>
    request(`/admin/board/${id}`, { method: 'PATCH', body: { pinned }, token }),
  adminSetBoardHidden: (id, hidden, token) =>
    request(`/admin/board/${id}`, { method: 'PATCH', body: { hidden }, token }),
  adminDeleteBoardPost: (id, token) => request(`/admin/board/${id}`, { method: 'DELETE', token }),

  adminCategories: (token) => request('/admin/categories', { token }),
  adminAddCategory: (name, token) =>
    request('/admin/categories', { method: 'POST', body: { name }, token }),
  adminRemoveCategory: (id, token) => request(`/admin/categories/${id}`, { method: 'DELETE', token }),
};

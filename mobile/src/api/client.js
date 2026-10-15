import { API_URL } from '../config';

// Ошибка API с текстом сервера: сервер уже пишет по-русски, экраны показывают как есть.
// status 0 — до сервера не дошли (нет сети).
export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Токен живёт здесь, а не в контексте: request() вызывают и вне React (TanStack Query).
let token = null;
let onUnauthorized = () => {};

export function setToken(value) {
  token = value;
}

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

function toQuery(params = {}) {
  const pairs = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!pairs.length) return '';
  return '?' + pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

export async function request(path, { method = 'GET', body, query } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(API_URL + path + toQuery(query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз');
  }

  // Не JSON бывает, когда отвечает не наш сервер, а прокси Render (502 при перезапуске).
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 401 с токеном — токен истёк или аккаунт удалён; без токена это неверный пароль.
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(res.status, data.error || `Ошибка сервера (${res.status})`, data.code);
  }
  return data;
}

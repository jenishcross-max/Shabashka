import { request } from './client';

// Тот же вход, что на сайте: в ответ — JWT на 30 дней и пользователь.
export const login = (email, password) => request('/auth/login', { method: 'POST', body: { email, password } });
export const register = (fields) => request('/auth/register', { method: 'POST', body: fields });
export const me = () => request('/auth/me');
export const resendVerification = () => request('/auth/resend-verification', { method: 'POST' });

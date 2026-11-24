// Объявления для робота на посадочной странице или в разделе (см.
// edge-functions/landing-meta.js и section-meta.js): за ними ходим в API на
// Render. Бэкенд не ответил за 4 секунды — робот получает страницу без списка,
// а не ошибку.
import { BACKEND_ORIGIN } from './bots.js';

const LIST_TIMEOUT_MS = 4000;

async function fetchList(kind, params, limit) {
  const query = new URLSearchParams({ ...params, limit: String(limit) });
  try {
    const res = await fetch(`${BACKEND_ORIGIN}/api/${kind}?${query}`, {
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return ((await res.json())[kind] || []).map((item) => ({ ...item, kind }));
  } catch {
    return [];
  }
}

// page.orders — под вакансиями ещё и разовые заказы (страницы городов, «онлайн»).
export async function listItems(page) {
  const [main, orders] = await Promise.all([
    fetchList(page.kind, page.params, 24),
    page.orders ? fetchList('orders', page.params, 12) : [],
  ]);
  return [...main, ...orders];
}

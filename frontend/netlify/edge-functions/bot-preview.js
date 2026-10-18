// WhatsApp/Telegram/Facebook и т.п. не рендерят SPA — им нужен статический HTML
// с og:-тегами под конкретный заказ/вакансию. Бэкенд это уже умеет (backend/src/meta.js),
// но фронтенд и бэкенд — разные домены, поэтому для ботов проксируем запрос на Render,
// а обычных пользователей пропускаем дальше на SPA как обычно.
import { BOT_UA_RE, BACKEND_ORIGIN } from '../lib/bots.js';

export default async (request, context) => {
  const ua = request.headers.get('user-agent') || '';
  if (!BOT_UA_RE.test(ua)) return context.next();

  // /orders/new и /vacancies/new — формы сайта, а не объявления: бэкенду
  // показать нечего, пусть роботу отвечает SPA.
  const url = new URL(request.url);
  if (!/^\/(orders|vacancies)\/\d+$/.test(url.pathname)) return context.next();

  // Бэкенд не ответил — лучше отдать роботу SPA, чем ошибку: Googlebot за
  // пятисотые реже ходит на сайт.
  let upstream;
  try {
    upstream = await fetch(`${BACKEND_ORIGIN}${url.pathname}${url.search}`, { headers: { 'user-agent': ua } });
  } catch {
    return context.next();
  }
  if (upstream.status >= 500) return context.next();
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
};

export const config = { path: ['/orders/:id', '/vacancies/:id'] };

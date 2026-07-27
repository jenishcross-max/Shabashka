// WhatsApp/Telegram/Facebook и т.п. не рендерят SPA — им нужен статический HTML
// с og:-тегами под конкретный заказ/вакансию. Бэкенд это уже умеет (backend/src/meta.js),
// но фронтенд и бэкенд — разные домены, поэтому для ботов проксируем запрос на Render,
// а обычных пользователей пропускаем дальше на SPA как обычно.
const BOT_UA_RE =
  /facebookexternalhit|WhatsApp|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot|vkShare|Googlebot|bingbot/i;

const BACKEND_ORIGIN = 'https://shabashka-zvkc.onrender.com';

export default async (request, context) => {
  const ua = request.headers.get('user-agent') || '';
  if (!BOT_UA_RE.test(ua)) return context.next();

  const url = new URL(request.url);
  const backendUrl = `${BACKEND_ORIGIN}${url.pathname}${url.search}`;
  const upstream = await fetch(backendUrl, { headers: { 'user-agent': ua } });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
};

export const config = { path: ['/orders/:id', '/vacancies/:id'] };

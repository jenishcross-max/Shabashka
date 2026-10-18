// Посадочные страницы /rabota/<slug> (см. src/landings.js) — с заголовком,
// описанием и текстом прямо в HTML. Без этого превью в Telegram и WhatsApp и
// часть поисковиков видели вместо «Работа в общепите» главную: SPA отдаёт на
// любой адрес один index.html.
//
// Заголовки и тексты есть в самом коде — их подставляем всем, это бесплатно.
// Список объявлений — только роботу: за ним надо сходить в API на Render, а
// человек и так увидит список через секунду. Бэкенд не ответил — робот получает
// страницу без списка, а не ошибку.
import { landingBySlug } from '../../src/landings.js';
import { landingHtml } from '../lib/landingHtml.js';
import { BOT_UA_RE, BACKEND_ORIGIN } from '../lib/bots.js';

const LIST_TIMEOUT_MS = 4000;

async function itemsFor(landing) {
  const query = new URLSearchParams({ ...landing.params, limit: '24' });
  try {
    const res = await fetch(`${BACKEND_ORIGIN}/api/${landing.kind}?${query}`, {
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    return (await res.json())[landing.kind] || [];
  } catch {
    return [];
  }
}

export default async (request, context) => {
  const url = new URL(request.url);
  const landing = landingBySlug(url.pathname.replace(/^\/rabota\//, '').replace(/\/$/, ''));
  if (!landing) return context.next();

  const response = await context.next();
  if (!(response.headers.get('content-type') || '').includes('text/html')) return response;

  const isBot = BOT_UA_RE.test(request.headers.get('user-agent') || '');
  const items = isBot ? await itemsFor(landing) : [];
  const html = landingHtml(await response.text(), { landing, url: `${url.origin}${url.pathname}`, items });

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, { status: response.status, headers });
};

export const config = { path: '/rabota/*' };

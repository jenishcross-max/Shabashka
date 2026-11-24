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
import { listItems } from '../lib/listItems.js';
import { BOT_UA_RE } from '../lib/bots.js';

export default async (request, context) => {
  const url = new URL(request.url);
  const landing = landingBySlug(url.pathname.replace(/^\/rabota\//, '').replace(/\/$/, ''));
  if (!landing) return context.next();

  const response = await context.next();
  if (!(response.headers.get('content-type') || '').includes('text/html')) return response;

  const isBot = BOT_UA_RE.test(request.headers.get('user-agent') || '');
  const items = isBot ? await listItems(landing) : [];
  const html = landingHtml(await response.text(), { landing, url: `${url.origin}${url.pathname}`, items });

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, { status: response.status, headers });
};

export const config = { path: '/rabota/*' };

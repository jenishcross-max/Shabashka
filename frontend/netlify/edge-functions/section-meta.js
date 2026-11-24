// Главная, /vacancies и /orders для робота (поиск 24 ноября 2026, см.
// src/landings.js → SECTIONS). SPA отдаёт им пустой #root, а в заголовке
// главной не было ни «работы», ни «Бишкека»: по «работа бишкек» сайт стоял на
// 8-м месте, а Яндекс, который JavaScript выполняет через раз, не видел на
// главной ничего.
//
// Роботу — заголовок, H1, вводный текст, свежие объявления и ссылки на все
// посадочные, как у /rabota/*. Человеку — страница как есть: заголовок главной
// уже стоит в index.html, а список React нарисует сам, без мигания голого текста
// до загрузки скриптов.
import { sectionByPath } from '../../src/landings.js';
import { landingHtml } from '../lib/landingHtml.js';
import { listItems } from '../lib/listItems.js';
import { BOT_UA_RE } from '../lib/bots.js';

export default async (request, context) => {
  if (!BOT_UA_RE.test(request.headers.get('user-agent') || '')) return context.next();
  const url = new URL(request.url);
  const section = sectionByPath(url.pathname);
  if (!section) return context.next();

  const response = await context.next();
  if (!(response.headers.get('content-type') || '').includes('text/html')) return response;

  const items = await listItems(section);
  const html = landingHtml(await response.text(), { landing: section, url: `${url.origin}${url.pathname}`, items });

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, { status: response.status, headers });
};

export const config = { path: ['/', '/vacancies', '/orders'] };

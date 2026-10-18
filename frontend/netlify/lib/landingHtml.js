// HTML посадочной страницы до JavaScript (см. edge-functions/landing-meta.js и
// src/landings.js). SPA отдаёт на любой адрес один и тот же index.html: те же
// <title> и описание, что у главной, и пустой #root. Здесь в нём появляются
// свои заголовок, описание, og-теги и canonical, а в #root — H1, вводный текст
// и ссылки. React при первом рендере всё это заменяет сам.
//
// Модуль без зависимостей: его выполняет Deno на Netlify, а проверяет node --test.
import { LANDINGS, landingPath } from '../../src/landings.js';

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Содержимое атрибута content у тега, найденного по имени. Описание в
// index.html записано в несколько строк — отсюда \s+ между атрибутами.
const setContent = (html, attr, value) =>
  html.replace(new RegExp(`(<meta\\s+${attr}\\s+content=")[^"]*(")`), `$1${esc(value)}$2`);

function links(current) {
  return LANDINGS.filter((l) => l.slug !== current)
    .map((l) => `<a href="${landingPath(l)}">${esc(l.short)}</a>`)
    .join(' · ');
}

// items — объявления для робота: { id, title }. Человеку их не подставляем: за
// ними надо сходить в API, а он и так увидит список через секунду.
export function landingHtml(html, { landing, url, items = [] }) {
  const title = `${landing.title} — Шабашка`;
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  out = setContent(out, 'name="description"', landing.description);
  out = setContent(out, 'property="og:title"', title);
  out = setContent(out, 'property="og:description"', landing.description);
  out = setContent(out, 'property="og:url"', url);
  out = out.replace('</head>', `<link rel="canonical" href="${esc(url)}" />\n  </head>`);
  if (landing.lang) out = out.replace(/<html lang="[^"]*">/, `<html lang="${landing.lang}">`);

  const list = items.length
    ? `<ul class="landing-list">${items
        .map((item) => `<li><a href="/${landing.kind}/${item.id}">${esc(item.title)}</a></li>`)
        .join('')}</ul>`
    : '';
  const body = `<main class="landing"><h1>${esc(landing.h1)}</h1><p>${esc(landing.intro)}</p>${list}<nav>${links(
    landing.slug
  )}</nav></main>`;
  return out.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}

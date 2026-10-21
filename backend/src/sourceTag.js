// Метка источника в ссылке на сайт: «шабашка.com/vacancies/12?s=t».
//
// Откуда приходят люди, было не видно: Telegram и встроенный браузер Threads
// не передают сайту, откуда человек пришёл, и Метрика писала такие заходы в
// «прямые» (замер 21 октября 2026, см. docs/plans/2026-10-21-subscribe-and-sources.md).
// Метка короткая: полное «?utm_source=threads» съело бы 20 из 500 знаков поста
// в Threads. Сайт сам разворачивает её в utm_source до запуска Метрики (см.
// frontend/index.html) — список кодов там тот же.
const CODES = { threads: 't', telegram: 'tg', bot: 'b' };

function tag(link, source) {
  if (!link) return '';
  const code = CODES[source];
  if (!code) return link;
  // Якорь — после параметров: «/board#p12» → «/board?s=tg#p12».
  const at = link.indexOf('#');
  const base = at < 0 ? link : link.slice(0, at);
  const anchor = at < 0 ? '' : link.slice(at);
  return `${base}${base.includes('?') ? '&' : '?'}s=${code}${anchor}`;
}

module.exports = { tag, CODES };

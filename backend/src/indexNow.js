// IndexNow для Яндекса. 24 ноября 2026: из Яндекса за месяц ни одного визита
// при 520 из Google. Новые вакансии и заказы сайт теперь сам сообщает Яндексу —
// тот приходит за ними сразу, а не когда перечитает sitemap. Раз в 10 минут —
// одним запросом всё новое за это время.
//
// Протокол: POST https://yandex.com/indexnow { host, key, keyLocation, urlList }.
// Ключ Яндекс сверяет с файлом на сайте — frontend/public/<KEY>.txt. Ключ не
// секрет: он и так лежит открыто. Отчёт — Вебмастер → «Индексирование» → IndexNow.
//
// Пропущенное (сервис спал, Яндекс отказал) не теряется: оно есть в sitemap.
const db = require('./db');

const KEY = '64412c0648dbb637141653081f130bb6';
const ENDPOINT = 'https://yandex.com/indexnow';
const EVERY_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 15 * 1000;

// Открытые вакансии и заказы, появившиеся после since. Примеры (is_example) в
// поиск не нужны.
async function freshUrls(site, since) {
  const { rows } = await db.query(
    `SELECT 'vacancies' AS kind, id FROM vacancies
      WHERE status = 'open' AND NOT is_example AND created_at > $1
     UNION ALL
     SELECT 'orders' AS kind, id FROM orders
      WHERE status = 'open' AND NOT is_example AND created_at > $1`,
    [since]
  );
  return rows.map((r) => `${site}/${r.kind}/${r.id}`);
}

// Проход: всё новое после since — Яндексу. Возвращает, с какого момента считать
// в следующий раз. Яндекс не ответил, занят (429) или упал (5xx) — бросаем:
// since не сдвинется, и те же адреса уйдут следующим проходом. Отказ по сути
// (400, 403 — ключ, 422 — чужие адреса) повтором не лечится — только в лог.
async function tick(site, since, fetchImpl = fetch) {
  const {
    rows: [{ now }],
  } = await db.query('SELECT NOW() AS now');
  const urls = await freshUrls(site, since);
  if (!urls.length) return now;

  const { host, origin } = new URL(site);
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key: KEY, keyLocation: `${origin}/${KEY}.txt`, urlList: urls }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 429 || res.status >= 500) throw new Error(`Яндекс ответил ${res.status}`);
  if (res.status >= 400) console.error(`[IndexNow] Яндекс отказал (${res.status}), адресов: ${urls.length}`);
  else console.log(`[IndexNow] Яндексу ${urls.length} адресов: ${res.status}`);
  return now;
}

// Только на боевом сайте: локально и без адреса сообщать нечего.
function start() {
  const site = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  if (!site.startsWith('https://')) return;
  let since = new Date(Date.now() - EVERY_MS);
  const run = () =>
    tick(site, since)
      .then((next) => {
        since = next;
      })
      .catch((err) => console.error('[IndexNow]', err.message));
  setInterval(run, EVERY_MS).unref();
}

module.exports = { KEY, freshUrls, tick, start };

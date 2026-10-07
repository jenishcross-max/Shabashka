const express = require('express');
const db = require('./db');
const asyncHandler = require('./asyncHandler');
const { ORDER_FIELDS, VACANCY_FIELDS } = require('./sqlFields');
const EMPLOYMENT_TYPES = require('./employmentTypes');
const EXPERIENCE_LEVELS = require('./experienceLevels');
const { money } = require('./money');

const router = express.Router();

// Тот же список — в frontend/netlify/edge-functions/bot-preview.js: Netlify
// отправляет сюда только тех, кого узнал он сам. Google-InspectionTool — это
// «Проверка URL» в Search Console: пусть видит то же, что Googlebot.
const BOT_UA_RE =
  /facebookexternalhit|WhatsApp|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot|vkShare|Googlebot|Google-InspectionTool|bingbot|YandexBot/i;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function baseUrl(req) {
  return process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
}

// В адресе может стоять что угодно: у сайта есть и /orders/new, и /orders/12/edit,
// а ссылку на такую страницу тоже пересылают в WhatsApp. Postgres на строку
// вместо числа отвечает ошибкой запроса, и превью этой страницы возвращало
// пятисотую вместо того, чтобы просто отдать обычную SPA-страницу.
function toId(raw) {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 && String(n) === String(raw) ? n : null;
}

// Страница объявления для роботов — поисковиков и превью в мессенджерах. SPA
// они не выполняют или выполняют через раз, поэтому здесь весь текст
// объявления прямо в HTML, а в <head> — свои canonical, описание и og:-теги.
//
// Раньше тут была заглушка без текста с <meta http-equiv="refresh"> на этот же
// адрес. Превью в WhatsApp она давала, а Googlebot видел переадресацию
// страницы на саму себя («Ошибка переадресации» в Search Console) и пустую
// страницу — и объявления в индекс не попадали.
//
// Закрытое объявление отдаём с noindex: превью по старой ссылке остаётся, а из
// поиска оно уходит. Текст тот же, что видит человек на сайте, — это не
// подмена страницы для поисковика, а та же страница без JavaScript.
const label = (list, value) => (list.find((item) => item.value === value) || {}).label;

const paragraphs = (text) =>
  String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');

const section = (title, text) => (text && String(text).trim() ? `<h2>${title}</h2>\n${paragraphs(text)}` : '');

const posted = (date) =>
  new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bishkek' });

// Как на карточке вакансии на сайте (formatSalary во фронтенде).
function salary(min, max) {
  if (!min && !max) return 'По договорённости';
  if (min && max) return `${money(min)}–${money(max)} сом`;
  if (min) return `от ${money(min)} сом`;
  return `до ${money(max)} сом`;
}

// schema.org JobPosting ждёт свои значения employmentType — как в VacancyDetail.
const SCHEMA_EMPLOYMENT_TYPE = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  shift: 'OTHER',
  gig: 'OTHER',
  internship: 'INTERN',
};

// Та же разметка, что SPA вставляет в VacancyDetail: по ней вакансия может
// попасть в блок вакансий Google. Googlebot SPA отсюда не видит — значит, и
// разметку должен получить здесь.
function jobPosting(v) {
  return {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: v.title,
    description: v.description,
    datePosted: new Date(v.created_at).toISOString(),
    employmentType: SCHEMA_EMPLOYMENT_TYPE[v.employment_type] || 'OTHER',
    hiringOrganization: { '@type': 'Organization', name: v.owner_name },
    jobLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: v.city, addressCountry: 'KG' },
    },
    ...(v.work_format === 'online' ? { jobLocationType: 'TELECOMMUTE' } : {}),
    ...(v.salary_min || v.salary_max
      ? {
          baseSalary: {
            '@type': 'MonetaryAmount',
            currency: 'KGS',
            value: {
              '@type': 'QuantitativeValue',
              minValue: v.salary_min || v.salary_max,
              maxValue: v.salary_max || v.salary_min,
              unitText: 'MONTH',
            },
          },
        }
      : {}),
  };
}

function page({ base, url, title, description, robots, jsonLd, body }) {
  const ld = jsonLd
    ? // «</script>» в тексте объявления закрыл бы тег раньше времени.
      `\n<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`
    : '';
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${robots ? `<meta name="robots" content="${robots}">\n` : ''}<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(`${base}/og-image.jpg`)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="Шабашка">
<meta name="twitter:card" content="summary_large_image">${ld}
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:16px;line-height:1.5;color:#1a1a1a}header a{margin-right:12px}.facts{color:#555}</style>
</head>
<body>
<header><a href="${base}/">Шабашка</a><a href="${base}/vacancies">Вакансии</a><a href="${base}/orders">Заказы</a></header>
<main>
${body}
</main>
</body>
</html>`;
}

// Ссылки на соседние объявления: Googlebot ходит по ссылкам, и страница
// без них — тупик, из которого он дальше сайта не узнает.
function moreLinks(base, path, heading, rows) {
  if (!rows.length) return '';
  const items = rows
    .map((r) => `<li><a href="${base}/${path}/${r.id}">${escapeHtml(r.title)}</a>${r.city ? ` — ${escapeHtml(r.city)}` : ''}</li>`)
    .join('\n');
  return `<nav>\n<h2>${heading}</h2>\n<ul>\n${items}\n</ul>\n</nav>`;
}

async function neighbours(table, item) {
  const { rows } = await db.query(
    `SELECT id, title, city FROM ${table} WHERE status = 'open' AND id <> $1
     ORDER BY (category = $2) DESC, COALESCE(bumped_at, created_at) DESC LIMIT 10`,
    [item.id, item.category]
  );
  return rows;
}

function missing(res, base) {
  res
    .status(404)
    .send(
      page({
        base,
        url: base,
        title: 'Объявление не найдено — Шабашка',
        description: 'Такого объявления нет: его удалили или адрес набран с ошибкой.',
        robots: 'noindex',
        body: '<h1>Объявление не найдено</h1>\n<p>Его удалили или адрес набран с ошибкой.</p>',
      })
    );
}

function article({ title, facts, closed, sections, url }) {
  return [
    '<article>',
    `<h1>${escapeHtml(title)}</h1>`,
    `<p class="facts">${facts.filter(Boolean).map(escapeHtml).join(' · ')}</p>`,
    closed ? '<p><strong>Объявление закрыто.</strong></p>' : '',
    ...sections,
    `<p><a href="${escapeHtml(url)}">Открыть на Шабашке и откликнуться</a></p>`,
    '</article>',
  ]
    .filter(Boolean)
    .join('\n');
}

router.get(
  '/orders/:id',
  asyncHandler(async (req, res, next) => {
    const ua = req.headers['user-agent'] || '';
    if (!BOT_UA_RE.test(ua)) return next();

    const id = toId(req.params.id);
    if (id === null) return next();

    const base = baseUrl(req);
    const { rows } = await db.query(
      `SELECT ${ORDER_FIELDS} FROM orders LEFT JOIN users ON users.id = orders.user_id WHERE orders.id = $1`,
      [id]
    );
    const order = rows[0];
    if (!order) return missing(res, base);

    const url = `${base}/orders/${order.id}`;
    const title = `${order.title} — Шабашка`;
    const description = `${order.category} · ${order.city}${
      order.budget ? ` · ${money(order.budget)} сом` : ''
    } — ${order.description}`.slice(0, 200);
    const closed = order.status !== 'open';
    const more = moreLinks(base, 'orders', 'Ещё заказы', await neighbours('orders', order));

    res.send(
      page({
        base,
        url,
        title,
        description,
        robots: closed ? 'noindex' : '',
        body: [
          article({
            title: order.title,
            facts: [
              order.category,
              order.city,
              order.work_format === 'online' ? 'Удалённо' : order.address,
              order.budget ? `${money(order.budget)} сом` : 'Цена договорная',
              `опубликовано ${posted(order.created_at)}`,
            ],
            closed,
            sections: [section('Описание', order.description)],
            url,
          }),
          more,
        ].join('\n'),
      })
    );
  })
);

router.get(
  '/vacancies/:id',
  asyncHandler(async (req, res, next) => {
    const ua = req.headers['user-agent'] || '';
    if (!BOT_UA_RE.test(ua)) return next();

    const id = toId(req.params.id);
    if (id === null) return next();

    const base = baseUrl(req);
    const { rows } = await db.query(
      `SELECT ${VACANCY_FIELDS} FROM vacancies LEFT JOIN users ON users.id = vacancies.user_id WHERE vacancies.id = $1`,
      [id]
    );
    const vacancy = rows[0];
    if (!vacancy) return missing(res, base);

    const url = `${base}/vacancies/${vacancy.id}`;
    const title = `${vacancy.title} — Шабашка`;
    const description = `${vacancy.category} · ${vacancy.city} · ${salary(vacancy.salary_min, vacancy.salary_max)} — ${
      vacancy.description
    }`.slice(0, 200);
    const closed = vacancy.status !== 'open';
    const more = moreLinks(base, 'vacancies', 'Ещё вакансии', await neighbours('vacancies', vacancy));

    res.send(
      page({
        base,
        url,
        title,
        description,
        robots: closed ? 'noindex' : '',
        // Закрытой вакансии разметка вредна: Google показал бы её в блоке
        // вакансий как открытую.
        jsonLd: closed ? null : jobPosting(vacancy),
        body: [
          article({
            title: vacancy.title,
            facts: [
              vacancy.category,
              vacancy.city,
              vacancy.work_format === 'online' ? 'Удалённо' : vacancy.address,
              salary(vacancy.salary_min, vacancy.salary_max),
              label(EMPLOYMENT_TYPES, vacancy.employment_type),
              label(EXPERIENCE_LEVELS, vacancy.experience),
              vacancy.for_students ? 'Можно студентам' : '',
              `опубликовано ${posted(vacancy.created_at)}`,
            ],
            closed,
            sections: [
              section('Описание', vacancy.description),
              section('Требования', vacancy.requirements),
              section('Условия', vacancy.conditions),
              section('График', vacancy.schedule),
            ],
            url,
          }),
          more,
        ].join('\n'),
      })
    );
  })
);

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /my-orders\nDisallow: /my-vacancies\nDisallow: /messages\nDisallow: /admin\nDisallow: /verify-email\nSitemap: ${baseUrl(
      req
    )}/sitemap.xml\n`
  );
});

router.get(
  '/sitemap.xml',
  asyncHandler(async (req, res) => {
    const base = baseUrl(req);
    const { rows: orders } = await db.query(
      "SELECT id, created_at FROM orders WHERE status = 'open' ORDER BY created_at DESC LIMIT 5000"
    );
    const { rows: vacancies } = await db.query(
      "SELECT id, created_at FROM vacancies WHERE status = 'open' ORDER BY created_at DESC LIMIT 5000"
    );

    const staticUrls = ['', '/orders', '/vacancies', '/terms', '/privacy'];
    const urls = [
      ...staticUrls.map((p) => `<url><loc>${base}${p}</loc></url>`),
      ...orders.map(
        (o) =>
          `<url><loc>${base}/orders/${o.id}</loc><lastmod>${new Date(o.created_at)
            .toISOString()
            .slice(0, 10)}</lastmod></url>`
      ),
      ...vacancies.map(
        (v) =>
          `<url><loc>${base}/vacancies/${v.id}</loc><lastmod>${new Date(v.created_at)
            .toISOString()
            .slice(0, 10)}</lastmod></url>`
      ),
    ];

    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join(
        '\n'
      )}\n</urlset>`
    );
  })
);

module.exports = router;

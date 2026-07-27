const express = require('express');
const db = require('./db');
const asyncHandler = require('./asyncHandler');

const router = express.Router();

const BOT_UA_RE =
  /facebookexternalhit|WhatsApp|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot|vkShare|Googlebot|bingbot/i;

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

// Превью-карточка для мессенджеров/соцсетей (WhatsApp, Telegram и т.п.) —
// им нужен статический HTML с og:-тегами, SPA они не рендерят.
router.get(
  '/orders/:id',
  asyncHandler(async (req, res, next) => {
    const ua = req.headers['user-agent'] || '';
    if (!BOT_UA_RE.test(ua)) return next();

    const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    const order = rows[0];
    if (!order) return next();

    const url = `${baseUrl(req)}/orders/${order.id}`;
    const title = `${order.title} — Шабашка`;
    const description = `${order.category} · ${order.city}${
      order.budget ? ` · ${order.budget} сом` : ''
    } — ${order.description}`.slice(0, 200);
    res.send(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(`${baseUrl(req)}/og-image.jpg`)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="Шабашка">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${escapeHtml(url)}">
</head>
<body>
<a href="${escapeHtml(url)}">${escapeHtml(title)}</a>
</body>
</html>`);
  })
);

router.get(
  '/vacancies/:id',
  asyncHandler(async (req, res, next) => {
    const ua = req.headers['user-agent'] || '';
    if (!BOT_UA_RE.test(ua)) return next();

    const { rows } = await db.query('SELECT * FROM vacancies WHERE id = $1', [req.params.id]);
    const vacancy = rows[0];
    if (!vacancy) return next();

    const url = `${baseUrl(req)}/vacancies/${vacancy.id}`;
    const title = `${vacancy.title} — Шабашка`;
    const description = `${vacancy.category} · ${vacancy.city} — ${vacancy.description}`.slice(
      0,
      200
    );
    res.send(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(`${baseUrl(req)}/og-image.jpg`)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="Шабашка">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${escapeHtml(url)}">
</head>
<body>
<a href="${escapeHtml(url)}">${escapeHtml(title)}</a>
</body>
</html>`);
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

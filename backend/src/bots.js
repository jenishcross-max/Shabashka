// Кого считаем роботом — поисковики и превью ссылок в мессенджерах. Им отдаём
// готовый HTML (см. meta.js), а их заходы не считаем переходами людей (см.
// routes/subscribe.js). Тот же список — в frontend/netlify/lib/bots.js: Netlify
// отправляет на бэкенд только тех, кого узнал он сам. Google-InspectionTool —
// это «Проверка URL» в Search Console: пусть видит то же, что Googlebot.
const BOT_UA_RE =
  /facebookexternalhit|WhatsApp|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot|vkShare|Googlebot|Google-InspectionTool|bingbot|YandexBot/i;

module.exports = { BOT_UA_RE };

// Кого считаем роботом — поисковики и превью ссылок в мессенджерах. Им SPA не
// годится: JavaScript они не выполняют или выполняют через раз. Тот же список —
// в backend/src/meta.js. Google-InspectionTool — «Проверка URL» в Search
// Console: пусть видит то же, что Googlebot.
export const BOT_UA_RE =
  /facebookexternalhit|WhatsApp|Twitterbot|TelegramBot|Slackbot|LinkedInBot|Discordbot|vkShare|Googlebot|Google-InspectionTool|bingbot|YandexBot/i;

export const BACKEND_ORIGIN = 'https://shabashka-zvkc.onrender.com';

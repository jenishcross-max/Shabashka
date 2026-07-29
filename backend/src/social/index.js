const video = require('./video');
const hosting = require('./hosting');
const instagram = require('./instagram');

// Публичный адрес самого бэкенда — по нему Instagram придёт за роликом. Отдельной
// переменной не заводим: адрес уже известен из настроек вебхука, а на Render его
// в любом случае подставляет RENDER_EXTERNAL_URL.
function backendUrl() {
  const url = process.env.TELEGRAM_WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || '';
  return url.replace(/\/$/, '');
}

// Собирает ролик по объявлению и, если Instagram настроен, выкладывает его сам.
// Иначе возвращает mp4 — публиковать вручную. Ролик отдаём и при ошибке
// публикации: работа уже сделана, терять её из-за просроченного токена незачем.
async function shareListing(parsed, listingType) {
  const buffer = await video.build(parsed, listingType);
  const caption = video.caption(parsed, listingType);
  const base = backendUrl();

  if (!instagram.isConfigured()) {
    return { posted: false, reason: 'Instagram не настроен', buffer, caption };
  }
  if (!base) {
    return { posted: false, reason: 'Не задан адрес бэкенда', buffer, caption };
  }

  const name = hosting.put(video.fileName(), buffer);
  try {
    await instagram.publishReel(`${base}/api/social/video/${name}`, caption);
    return { posted: true, buffer, caption };
  } catch (err) {
    return { posted: false, reason: err.message, buffer, caption };
  }
}

module.exports = { shareListing, router: hosting.router };

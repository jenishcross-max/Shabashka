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
  // Логи по этапам: на бесплатном Render процесс может умереть посередине (сон
  // сервиса или нехватка памяти), и тогда молчание в чате — единственный симптом.
  // По последней строке в логах видно, на чём именно оборвалось.
  console.log('[insta] сборка ролика');
  const buffer = await video.build(parsed, listingType);
  const caption = video.caption(parsed, listingType);
  const base = backendUrl();
  console.log(`[insta] ролик собран: ${buffer.length} байт`);

  if (!instagram.isConfigured()) {
    return { posted: false, reason: 'Instagram не настроен', buffer, caption };
  }
  if (!base) {
    return { posted: false, reason: 'Не задан адрес бэкенда', buffer, caption };
  }

  const name = hosting.put(video.fileName(), buffer);
  try {
    console.log(`[insta] отдаю Instagram ссылку ${base}/api/social/video/${name}`);
    const mediaId = await instagram.publishReel(`${base}/api/social/video/${name}`, caption);
    console.log(`[insta] опубликовано: ${mediaId}`);
    return { posted: true, buffer, caption };
  } catch (err) {
    console.log(`[insta] не вышло: ${err.message}`);
    return { posted: false, reason: err.message, buffer, caption };
  }
}

module.exports = { shareListing, router: hosting.router };

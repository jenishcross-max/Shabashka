const video = require('./video');
const hosting = require('./hosting');
const instagram = require('./instagram');
const threads = require('./threads');

// Публичный адрес самого бэкенда — по нему площадки придут за роликом. Отдельной
// переменной не заводим: адрес уже известен из настроек вебхука, а на Render его
// в любом случае подставляет RENDER_EXTERNAL_URL.
function backendUrl() {
  const url = process.env.TELEGRAM_WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || '';
  return url.replace(/\/$/, '');
}

// Собирает ролик по объявлению и раскладывает его по настроенным площадкам.
// Ролик отдаём и при ошибке публикации: работа уже сделана, терять её из-за
// просроченного токена незачем.
// Сколько роликов прямо сейчас в работе — от начала сборки до ответа площадок.
// Счётчик живёт в памяти процесса: перезапуск обнуляет его вместе с самими
// сборками, так что расходиться с реальностью ему негде.
let inFlight = 0;
const pending = () => inFlight;

async function shareListing(parsed, listingType, siteLink) {
  inFlight += 1;
  try {
    return await run(parsed, listingType, siteLink);
  } finally {
    inFlight -= 1;
  }
}

// Одна площадка не должна ронять другую: в Threads ролик уходит, даже если у
// Instagram протух токен, и наоборот. Поэтому ошибку ловим здесь, а наверх
// отдаём результат в одинаковой форме.
async function post(label, fn) {
  try {
    const id = await fn();
    console.log(`[${label}] опубликовано: ${id}`);
    return { posted: true };
  } catch (err) {
    console.log(`[${label}] не вышло: ${err.message}`);
    return { posted: false, reason: err.message };
  }
}

async function run(parsed, listingType, siteLink) {
  // Логи по этапам: на бесплатном Render процесс может умереть посередине (сон
  // сервиса или нехватка памяти), и тогда молчание в чате — единственный симптом.
  // По последней строке в логах видно, на чём именно оборвалось.
  console.log('[видео] сборка ролика');
  const { buffer, credit } = await video.build(parsed, listingType);
  const caption = video.caption(parsed, listingType, credit);
  const base = backendUrl();
  console.log(`[видео] ролик собран: ${buffer.length} байт`);

  const wantInsta = instagram.isConfigured();
  const wantThreads = threads.isConfigured();

  if (!wantInsta && !wantThreads) {
    return { buffer, caption, reason: 'Ни Instagram, ни Threads не настроены' };
  }
  if (!base) {
    return { buffer, caption, reason: 'Не задан адрес бэкенда' };
  }

  // Ролик и ссылка на него общие: обе площадки скачивают файл сами, каждая со
  // своих серверов, и второй раз кодировать то же самое незачем.
  const url = `${base}/api/social/video/${hosting.put(video.fileName(), buffer)}`;
  console.log(`[видео] отдаю ссылку ${url}`);

  // Параллельно, а не по очереди: каждая площадка обрабатывает ролик у себя
  // минуту-другую, и последовательное ожидание удвоило бы время до ответа в чат.
  const [ig, th] = await Promise.all([
    wantInsta ? post('insta', () => instagram.publishReel(url, caption, video.COVER_MS)) : null,
    wantThreads
      ? post('threads', () =>
          threads.publishReel(url, video.threadsText(parsed, listingType, siteLink, credit))
        )
      : null,
  ]);

  return { buffer, caption, instagram: ig, threads: th };
}

module.exports = { shareListing, pending, router: hosting.router };

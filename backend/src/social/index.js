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

// Meta считает вызовы Graph API на час вперёд для всего приложения, а не по
// ролику: один Reels — это уже три десятка запросов (создание контейнера,
// опрос статуса раз в несколько секунд почти две минуты, публикация). Если
// админ разбирает пачку скриншотов, ролики раньше уходили в Instagram и
// Threads параллельно и быстро упирались в «Application request limit
// reached». Через очередь с паузой они идут по одному, и лимит набирается
// медленнее. Очередь — цепочка промисов в памяти процесса, ничего не хранит.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MIN_INTERVAL_MS = 90 * 1000;
let chain = Promise.resolve();
let lastStartedAt = 0;

function schedule(fn) {
  const job = chain.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastStartedAt);
    if (wait > 0) await sleep(wait);
    lastStartedAt = Date.now();
    return fn();
  });
  // Ошибка одного ролика не должна обрывать очередь для следующих за ним.
  chain = job.catch(() => {});
  return job;
}

async function shareListing(parsed, listingType, siteLink) {
  return schedule(async () => {
    inFlight += 1;
    try {
      return await run(parsed, listingType, siteLink);
    } finally {
      inFlight -= 1;
    }
  });
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

// Ролики, которые ушли не везде: по ним админ может нажать в боте «попробовать
// ещё раз». Держим в памяти вместе с самим mp4 — собирать его заново было бы
// минуту работы и лишний расход, а весит он пару сотен килобайт. Перезапуск
// процесса всё это теряет, и это нормально: кнопка просто скажет, что ролик
// выветрился, а сам ролик у админа уже есть в чате.
const RETRY_TTL_MS = 40 * 60 * 1000;
const retryJobs = new Map();

function sweepJobs() {
  const now = Date.now();
  for (const [id, job] of retryJobs) {
    if (job.expiresAt <= now) retryJobs.delete(id);
  }
}

function remember(job, targets) {
  sweepJobs();
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  retryJobs.set(id, { ...job, targets, expiresAt: Date.now() + RETRY_TTL_MS });
  return id;
}

// Раскладывает уже собранный ролик по перечисленным площадкам. Ссылку выкладываем
// заново на каждой попытке: с прошлого раза файл мог выветриться из hosting.
async function deliver(job, targets) {
  const url = `${backendUrl()}/api/social/video/${hosting.put(video.fileName(), job.buffer)}`;
  console.log(`[видео] отдаю ссылку ${url}`);

  // Параллельно, а не по очереди: каждая площадка обрабатывает ролик у себя
  // минуту-другую, и последовательное ожидание удвоило бы время до ответа в чат.
  const [instagramResult, threadsResult] = await Promise.all([
    targets.includes('instagram')
      ? post('insta', () => instagram.publishReel(url, job.caption, video.COVER_MS))
      : null,
    // Threads публикуется текстом, без ролика: контейнер типа TEXT не кодирует
    // видео и публикуется сразу, поэтому ссылку на файл сюда не передаём.
    targets.includes('threads') ? post('threads', () => threads.publishText(job.threadsText)) : null,
  ]);

  const result = { instagram: instagramResult, threads: threadsResult };
  const failed = targets.filter((name) => result[name] && !result[name].posted);
  return { result, failed };
}

// Повторная попытка — по кнопке в боте или сама, в фоне (см. AUTO_RETRY_ATTEMPTS
// в telegram/bot.js). Возвращает null, если ролик уже выветрился из памяти —
// тогда публиковать остаётся только вручную. Идёт через ту же очередь, что и
// первая публикация: авто-повторы нескольких объявлений не должны стартовать
// в Meta все разом.
async function retry(id) {
  sweepJobs();
  const job = retryJobs.get(id);
  if (!job) return null;

  return schedule(async () => {
    inFlight += 1;
    try {
      const { result, failed } = await deliver(job, job.targets);
      if (failed.length) {
        // Повторяем в следующий раз только то, что снова не вышло, и даём ролику
        // ещё столько же времени: следующая попытка может случиться не сразу.
        job.targets = failed;
        job.expiresAt = Date.now() + RETRY_TTL_MS;
      } else {
        retryJobs.delete(id);
      }
      return { ...result, retryId: failed.length ? id : null };
    } finally {
      inFlight -= 1;
    }
  });
}

async function run(parsed, listingType, siteLink) {
  // Логи по этапам: на бесплатном Render процесс может умереть посередине (сон
  // сервиса или нехватка памяти), и тогда молчание в чате — единственный симптом.
  // По последней строке в логах видно, на чём именно оборвалось.
  console.log('[видео] сборка ролика');
  const { buffer, credit } = await video.build(parsed, listingType);
  const caption = video.caption(parsed, listingType, credit, siteLink);
  const base = backendUrl();
  console.log(`[видео] ролик собран: ${buffer.length} байт`);

  const targets = [];
  if (instagram.isConfigured()) targets.push('instagram');
  if (threads.isConfigured()) targets.push('threads');

  if (!targets.length) {
    return { buffer, caption, reason: 'Ни Instagram, ни Threads не настроены' };
  }
  if (!base) {
    return { buffer, caption, reason: 'Не задан адрес бэкенда' };
  }

  // Ролик один на обе площадки: каждая скачивает файл сама, со своих серверов,
  // и второй раз кодировать то же самое незачем.
  // credit (автор трека) сюда не идёт: это условие лицензии на музыку в ролике,
  // а Threads-пост теперь текстовый, без ролика и без музыки.
  const job = { buffer, caption, threadsText: video.threadsText(parsed, listingType, siteLink) };
  const { result, failed } = await deliver(job, targets);

  return { buffer, caption, ...result, retryId: failed.length ? remember(job, failed) : null };
}

module.exports = { shareListing, retry, pending, router: hosting.router };

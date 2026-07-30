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
//
// Восемь часов, а не сорок минут, как было сначала: Instagram на частых
// публикациях отвечает «User is performing too many actions», и это не сбой, а
// троттлинг на часы. За сорок минут он не отпускал, задание выветривалось, и
// объявление приходилось искать и выкладывать заново руками — ровно то, чего
// автоповторы должны избавлять. Расписание самих попыток — в telegram/bot.js.
const RETRY_TTL_MS = 8 * 60 * 60 * 1000;
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

// Всё, что нужно для публикации, кроме ролика. Текст поста в Threads считается
// из тех же полей объявления и ничего не ждёт — потому Threads и уходит первым.
function makeJob(parsed, listingType, siteLink) {
  return {
    parsed,
    listingType,
    siteLink,
    // credit (автор трека) сюда не идёт: это условие лицензии на музыку в ролике,
    // а Threads-пост текстовый, без ролика и без музыки.
    threadsText: video.threadsText(parsed, listingType, siteLink),
  };
}

// Ролик нужен только Instagram, поэтому собирается прямо перед ним, а не в
// начале. Логи по этапам: на бесплатном Render процесс может умереть посередине
// (сон сервиса или нехватка памяти), и тогда молчание в чате — единственный
// симптом. По последней строке в логах видно, на чём именно оборвалось.
async function buildVideo(job) {
  console.log('[видео] сборка ролика');
  const { buffer, credit } = await video.build(job.parsed, job.listingType);
  console.log(`[видео] ролик собран: ${buffer.length} байт`);
  job.buffer = buffer;
  job.caption = video.caption(job.parsed, job.listingType, credit, job.siteLink);
}

// Раскладывает объявление по перечисленным площадкам — в том порядке, в котором
// они перечислены (см. run).
async function deliver(job, targets) {
  const result = { instagram: null, threads: null };

  // Threads — первым: пост текстовый, ролика он не ждёт, и объявление появляется
  // там через секунды после того, как встало на сайт. Часовой лимит Graph API у
  // Instagram и Threads общий на всё приложение, но текстовый пост — это два-три
  // вызова против трёх десятков на Reels, так что Instagram от такой уступки
  // ничего не теряет.
  if (targets.includes('threads')) {
    result.threads = await post('threads', () => threads.publishText(job.threadsText));
  }

  // Instagram — в конце: ему нужен готовый mp4, а сборка и обработка на стороне
  // Meta занимают минуты. Провал Threads его не отменяет, и наоборот.
  // Ссылку выкладываем заново на каждой попытке: с прошлого раза файл мог
  // выветриться из hosting.
  if (targets.includes('instagram')) {
    const base = backendUrl();
    if (!base) {
      result.instagram = { posted: false, reason: 'не задан адрес бэкенда' };
      return finish(result, targets);
    }
    if (!job.buffer) {
      try {
        await buildVideo(job);
      } catch (err) {
        // Сборка — такой же повторяемый шаг, как и публикация: «fetch failed»
        // здесь почти всегда сетевой сбой на музыке или шрифте и сам проходит
        // через несколько минут. Объявление к этому моменту уже на сайте, в
        // Telegram и в Threads — терять Instagram насовсем незачем.
        console.log(`[видео] не собрался: ${err.message}`);
        result.instagram = { posted: false, reason: `ролик не собрался: ${err.message}` };
        return finish(result, targets);
      }
    }
    const url = `${base}/api/social/video/${hosting.put(video.fileName(), job.buffer)}`;
    console.log(`[видео] отдаю ссылку ${url}`);
    result.instagram = await post('insta', () => instagram.publishReel(url, job.caption, video.COVER_MS));
  }

  return finish(result, targets);
}

function finish(result, targets) {
  return { result, failed: targets.filter((name) => result[name] && !result[name].posted) };
}

// Повторная попытка — по кнопке в боте или сама, в фоне (см. AUTO_RETRY_DELAYS
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
      // Ролика может не быть вовсе: первая попытка могла оборваться ещё на сборке.
      // Пересоберёт его deliver — там же, где он и нужен.
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
  // Порядок в списке — он же порядок публикации: сначала Threads, Instagram
  // последним (см. deliver).
  const targets = [];
  if (threads.isConfigured()) targets.push('threads');
  if (instagram.isConfigured()) targets.push('instagram');

  const job = makeJob(parsed, listingType, siteLink);
  if (!targets.length) {
    return { ...job, reason: 'Ни Threads, ни Instagram не настроены' };
  }

  const { result, failed } = await deliver(job, targets);

  // В памяти задание держим целиком, вместе с исходными полями объявления: если
  // ролик придётся пересобирать (сборка сорвалась или файл выветрился из
  // hosting), собирать его будет из чего.
  return { ...job, ...result, retryId: failed.length ? remember(job, failed) : null };
}

module.exports = { shareListing, retry, pending, router: hosting.router };

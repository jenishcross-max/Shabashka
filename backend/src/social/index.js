const video = require('./video');
const hosting = require('./hosting');
const instagram = require('./instagram');
const threads = require('./threads');
const net = require('./net');
const quota = require('./quota');

// Публичный адрес самого бэкенда — по нему площадки придут за роликом. Отдельной
// переменной не заводим: адрес уже известен из настроек вебхука, а на Render его
// в любом случае подставляет RENDER_EXTERNAL_URL.
function backendUrl() {
  const url = process.env.TELEGRAM_WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || '';
  return url.replace(/\/$/, '');
}

// Сколько объявлений едет в одном ролике. Квота Instagram считает посты, а не
// объявления, — три карточки в одном ролике втрое поднимают дневную пропускную
// способность аккаунта, ничего не обходя.
const BATCH_SIZE = 3;

// Объявления, ждущие своего ролика. Копятся, пока не наберётся полная тройка:
// выкладывать неполную пачку по таймеру не стали — пост квоты, потраченный на
// одно объявление, стоит дороже, чем задержка до следующих двух. В Threads при
// этом объявление уходит сразу, поэтому «ждёт» тут только Instagram.
const waiting = [];

// Threads суточной квоты на публикации почти не имеет, зато у него есть защита
// от частоты: посты залпом ловят подкод 2207051 («We restrict certain
// activity…») — блокировку на часы, которую повтором не снять. Раньше
// объявления уходили туда ровно с той скоростью, с какой админ присылал
// скриншоты, и на пачке это срабатывало. Десять минут — не квота, а темп живого
// человека: после паузы первый пост уходит сразу, ждёт только то, что пришло
// следом.
const THREADS_INTERVAL_MS = 10 * 60 * 1000;

// Ни ролик, ни пост в Threads не уезжают в тот же момент, когда админ прислал
// объявление: ролик ждёт тройку, пост — своей очереди. Отчитаться ответом на
// сообщение поэтому нельзя. Кто отчитается, решает вызывающий: social ничего не
// знает про Telegram.
let reelHandler = null;
function onReel(fn) {
  reelHandler = fn;
}

let threadsHandler = null;
function onThreads(fn) {
  threadsHandler = fn;
}

// Сколько роликов прямо сейчас в работе — от начала сборки до ответа площадок.
// Счётчик живёт в памяти процесса: перезапуск обнуляет его вместе с самими
// сборками, так что расходиться с реальностью ему негде.
let inFlight = 0;
const pending = () => inFlight;
const queued = () => waiting.length;

// Meta считает вызовы Graph API на час вперёд для всего приложения, а не по
// ролику: один Reels — это уже три десятка запросов (создание контейнера,
// опрос статуса раз в несколько секунд почти две минуты, публикация). Если
// админ разбирает пачку скриншотов, ролики раньше уходили в Instagram и
// Threads параллельно и быстро упирались в «Application request limit
// reached». Через очередь с паузой они идут по одному, и лимит набирается
// медленнее. Очередь — цепочка промисов в памяти процесса, ничего не хранит.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Очередь с минимальным промежутком между заданиями — цепочка промисов в памяти
// процесса, ничего не хранит. У каждой площадки своя: полторы минуты для
// Instagram считают часовой лимит Graph API, десять минут для Threads — его
// антиспам, и ролик не должен стоять за текстовым постом.
function pacer(minIntervalMs) {
  let chain = Promise.resolve();
  let lastStartedAt = 0;
  let queueLength = 0;

  const schedule = (fn) => {
    queueLength += 1;
    const job = chain.then(async () => {
      const wait = minIntervalMs - (Date.now() - lastStartedAt);
      if (wait > 0) await sleep(wait);
      lastStartedAt = Date.now();
      queueLength -= 1;
      return fn();
    });
    // Ошибка одного задания не должна обрывать очередь для следующих за ним.
    chain = job.catch(() => {});
    return job;
  };
  // Сколько заданий ещё не начинали выполняться, включая только что добавленное.
  schedule.queued = () => queueLength;
  return schedule;
}

const MIN_INTERVAL_MS = 90 * 1000;
const schedule = pacer(MIN_INTERVAL_MS);
const paceThreads = pacer(THREADS_INTERVAL_MS);

// Одна площадка не должна ронять другую: в Threads пост уходит, даже если у
// Instagram протух токен, и наоборот. Поэтому ошибку ловим здесь, а наверх
// отдаём результат в одинаковой форме.
async function post(label, fn) {
  try {
    const id = await fn();
    console.log(`[${label}] опубликовано: ${id}`);
    return { posted: true };
  } catch (err) {
    console.log(`[${label}] не вышло: ${err.message}`);
    return { posted: false, reason: err.message, hardLimit: net.isHardLimit(err) };
  }
}

// Задания, которые ушли не везде: по ним админ может нажать в боте «попробовать
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

// Ролик собирается прямо перед отправкой в Instagram, а не в момент, когда
// объявление пришло: до полной тройки оно может пролежать в очереди долго, и
// смысла держать всё это время готовый mp4 в памяти нет. Логи по этапам: на
// бесплатном Render процесс может умереть посередине (сон сервиса или нехватка
// памяти), и тогда молчание в чате — единственный симптом. По последней строке
// в логах видно, на чём именно оборвалось.
async function buildVideo(job) {
  console.log(`[видео] сборка ролика: объявлений ${job.items.length}`);
  const { buffer, credit } = await video.build(job.items);
  console.log(`[видео] ролик собран: ${buffer.length} байт`);
  job.buffer = buffer;
  job.caption = video.caption(job.items, credit);
}

// Собирает ролик (если ещё не собран) и публикует его в Instagram. Единственная
// площадка, которой нужна очередь: у неё есть видео, которое надо закодировать
// на стороне Meta, и общий с Threads часовой лимит Graph API, который тридцать
// вызовов одного Reels выедают быстро.
async function deliverInstagram(job) {
  const base = backendUrl();
  if (!base) return { posted: false, reason: 'не задан адрес бэкенда' };

  if (!job.buffer) {
    try {
      await buildVideo(job);
    } catch (err) {
      // Сборка — такой же повторяемый шаг, как и публикация: «fetch failed»
      // здесь почти всегда сетевой сбой на музыке или шрифте и сам проходит
      // через несколько минут. Объявления к этому моменту уже на сайте, в
      // Telegram и в Threads — терять Instagram насовсем незачем.
      console.log(`[видео] не собрался: ${err.message}`);
      return { posted: false, reason: `ролик не собрался: ${err.message}` };
    }
  }

  // Место в суточной квоте занимаем здесь, вплотную к созданию контейнера:
  // именно контейнер Instagram и считает. Если места нет — до Meta не идём
  // вовсе, потому что неудачная попытка списала бы единицу так же, как удачная.
  // Провал при этом обычный, не hardLimit: своей проверке повтор ничего не
  // стоит, а к следующей попытке окно может уже освободиться.
  if (!quota.take()) {
    const free = quota.freeAt();
    const when = free ? `, место освободится к ${free.toLocaleString('ru-RU')}` : '';
    return {
      posted: false,
      reason: `выбрана суточная норма: ${quota.used()} из ${quota.DAILY_LIMIT}${when}`,
    };
  }

  // Ссылку выкладываем заново на каждой попытке: с прошлого раза файл мог
  // выветриться из hosting.
  const url = `${base}/api/social/video/${hosting.put(video.fileName(), job.buffer)}`;
  console.log(`[видео] отдаю ссылку ${url}`);
  return post('insta', () => instagram.publishReel(url, job.caption, video.COVER_MS));
}

function scheduleInstagram(job) {
  return schedule(async () => {
    inFlight += 1;
    try {
      return await deliverInstagram(job);
    } finally {
      inFlight -= 1;
    }
  });
}

// Повторная попытка — по кнопке в боте или сама, в фоне (см. AUTO_RETRY_DELAYS
// в telegram/bot.js). Возвращает null, если задание уже выветрилось из памяти —
// тогда публиковать остаётся только вручную.
async function retry(id) {
  sweepJobs();
  const job = retryJobs.get(id);
  if (!job) return null;

  const result = { instagram: null, threads: null };
  if (job.targets.includes('threads')) {
    // Повтор идёт через ту же очередь, что и обычная публикация: антиспам
    // Threads считает все посты подряд, и повтор без паузы продлил бы ровно ту
    // блокировку, из-за которой первая попытка и не прошла.
    result.threads = await paceThreads(() => post('threads', () => threads.publishText(job.threadsText)));
  }
  // Ролика может не быть вовсе: первая попытка могла оборваться ещё на сборке.
  // Пересоберёт его deliverInstagram — там же, где он и нужен.
  if (job.targets.includes('instagram')) {
    result.instagram = await scheduleInstagram(job);
  }

  const failed = job.targets.filter((name) => result[name] && !result[name].posted);
  if (failed.length) {
    // Повторяем в следующий раз только то, что снова не вышло, и даём заданию
    // ещё столько же времени: следующая попытка может случиться не сразу.
    job.targets = failed;
    job.expiresAt = Date.now() + RETRY_TTL_MS;
  } else {
    retryJobs.delete(id);
  }
  return { ...job, ...result, retryId: failed.length ? id : null };
}

// Собирает и выкладывает ролик по накопившейся тройке. Вызывается не из ответа
// на сообщение, а сама по себе, — поэтому отчитывается через reelHandler.
async function runBatch(entries) {
  const job = { items: entries.map(({ ctx, ...item }) => item), targets: ['instagram'] };
  const instagramResult = await scheduleInstagram(job);
  const failed = instagramResult.posted ? [] : ['instagram'];

  if (!reelHandler) return;
  await reelHandler({
    ...job,
    instagram: instagramResult,
    threads: null,
    contexts: entries.map((entry) => entry.ctx),
    retryId: failed.length ? remember(job, failed) : null,
  });
}

// Пускает ролик, как только набралась полная тройка. Намеренно без await:
// сборка и обработка на стороне Meta занимают минуты, а следующее объявление
// из пачки не должно их ждать.
function flush() {
  if (waiting.length < BATCH_SIZE) return;
  const entries = waiting.splice(0, BATCH_SIZE);
  runBatch(entries).catch((err) => console.error('Автопостинг (ролик):', err));
}

// Ставит пост в очередь Threads и отчитывается сам, когда до него дошло: между
// постами до десяти минут, столько ждать ответом на сообщение нельзя.
function scheduleThreads(text, title, ctx) {
  paceThreads(() => post('threads', () => threads.publishText(text)))
    .then(async (result) => {
      const retryId = result.posted ? null : remember({ threadsText: text }, ['threads']);
      if (threadsHandler) await threadsHandler({ ...result, title, ctx, retryId });
    })
    .catch((err) => console.error('Автопостинг (threads):', err));
  return paceThreads.queued();
}

// Объявление уходит в Threads по одному и текстом, а в очередь на ролик — ждать
// компанию. Threads пачками не собираем: своей квоты Instagram он не тратит,
// лимиты у него заметно щедрее, и отдельными постами объявление и находят
// чаще, и появляется оно там раньше.
async function shareListing(parsed, listingType, siteLink, ctx) {
  const skipped = [];
  const result = { threads: null, skipped, batchSize: BATCH_SIZE };

  if (threads.isConfigured()) {
    const text = video.threadsText(parsed, listingType, siteLink);
    result.threadsQueued = true;
    result.threadsWaiting = scheduleThreads(text, parsed.title, ctx);
  } else {
    skipped.push('threads');
    console.log('[threads] не настроен — пропускаю');
  }

  if (instagram.isConfigured()) {
    waiting.push({ parsed, listingType, siteLink, ctx });
    result.queued = true;
  } else {
    skipped.push('instagram');
    console.log('[instagram] не настроен — пропускаю');
  }

  // Ненастроенную площадку раньше пропускали молча — и молчание нельзя было
  // отличить от «всё хорошо». Отдаём её наверх отдельно от провалов: повторять
  // тут нечего, дело не в сбое, а в незаданных переменных окружения.
  if (skipped.length === 2) result.reason = 'Ни Threads, ни Instagram не настроены';

  // Считаем очередь до отправки: flush заберёт из неё тройку, и админу надо
  // сказать, сколько объявлений ждёт после этого объявления, а не до него.
  result.waiting = waiting.length % BATCH_SIZE;
  flush();
  return result;
}

module.exports = {
  shareListing,
  retry,
  onReel,
  onThreads,
  pending,
  queued,
  threadsQueued: () => paceThreads.queued(),
  quota,
  BATCH_SIZE,
  THREADS_INTERVAL_MIN: Math.round(THREADS_INTERVAL_MS / 60000),
  router: hosting.router,
};

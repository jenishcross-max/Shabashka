const video = require('./video');
const card = require('./card');
const hosting = require('./hosting');
const instagram = require('./instagram');
const threads = require('./threads');
const net = require('./net');
const quota = require('./quota');
const tokens = require('./tokens');
const adTracker = require('./adTracker');
const leads = require('./leads');

// Публичный адрес самого бэкенда — по нему площадки придут за роликом. Отдельной
// переменной не заводим: адрес уже известен из настроек вебхука, а на Render его
// в любом случае подставляет RENDER_EXTERNAL_URL.
function backendUrl() {
  const url = process.env.TELEGRAM_WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || '';
  return url.replace(/\/$/, '');
}

// Сколько объявлений едет в одном ролике.
//
// Было по одному, стало снова три — и причина в том, как Instagram смотрит на
// аккаунт. Полсотни почти одинаковых роликов в сутки — это поведение не живого
// человека, а рассылки, и лента такому аккаунту показывается по остаточному
// принципу: просмотров нет, хотя формально ничего не нарушено. Тройка в одном
// ролике даёт те же объявления втрое меньшим числом постов.
//
// Прежняя цена тройки — «объявление ждёт компанию и может не дождаться вовсе» —
// снята расписанием: пачка выезжает по часам, а не по наполнению, и неполная
// уезжает точно так же (см. RELEASE_INTERVAL_MS).
const BATCH_SIZE = 3;

// Как часто выпускаем ролик. Два с половиной часа — это 9–10 постов в сутки,
// ровным потоком, а не залпом на десять минут. Столько же примерно выкладывает
// живой аккаунт, который ведут руками.
const RELEASE_INTERVAL_MS = Number(process.env.INSTAGRAM_RELEASE_MINUTES || 150) * 60 * 1000;

// Сколько объявление ждёт своего ролика, прежде чем его выбросят из очереди.
// Из групп за день приходит больше, чем влезает в суточную норму постов, и без
// этого срока очередь росла бы до бесконечности, а в ролик попадало бы
// позавчерашнее. На сайте, в канале и в Threads объявление к этому моменту уже
// есть — Instagram ему не единственная дорога.
const QUEUE_TTL_MS = 6 * 60 * 60 * 1000;

// Объявления, ждущие своего ролика, — по очереди на каждый тип. Ролик выходит
// выпуском: «Вакансии дня», «Заказы дня», «Объявления дня», и мешать в одном
// разные типы нельзя: заголовок выпуска тогда пришлось бы делать общим, а
// хештеги — смешанными, и по объявлению о продаже дома приходили бы искать
// работу.
const waiting = new Map();

function queueFor(listingType) {
  if (!waiting.has(listingType)) waiting.set(listingType, []);
  return waiting.get(listingType);
}

// Выбрасываем то, что уже не дождётся. Возвращает, сколько выбросили, — это
// видно в логе: молчащая очередь и очередь, из которой всё утекает по сроку,
// выглядят одинаково, а значат разное.
//
// Платное не выбрасываем никогда. Дожить до срока оно, вообще говоря, не
// успевает — реклама уезжает сразу, мимо расписания (см. shareListing), — но
// проверка тут стоит не ради обычного хода дел, а ради всех прочих: за неё
// заплатили, и потеряться по таймеру она не должна ни при каких.
function dropStale(now = Date.now()) {
  let dropped = 0;
  for (const [listingType, q] of waiting) {
    const fresh = q.filter((entry) => now - entry.at < QUEUE_TTL_MS || entry.priority);
    dropped += q.length - fresh.length;
    waiting.set(listingType, fresh);
  }
  if (dropped) {
    console.log(`[очередь роликов] ${dropped} объявление(й) прождали больше ${QUEUE_TTL_MS / 3600000} ч — в ролик уже не беру`);
  }
  return dropped;
}

// Threads суточной квоты на публикации почти не имеет, зато у него есть защита
// от частоты: посты залпом ловят подкод 2207051 («We restrict certain
// activity…») — блокировку на часы, которую повтором не снять. Раньше
// объявления уходили туда ровно с той скоростью, с какой админ присылал
// скриншоты, и на пачке это срабатывало. Десять минут — не квота, а темп живого
// человека: после паузы первый пост уходит сразу, ждёт только то, что пришло
// следом.
const THREADS_INTERVAL_MS = 10 * 60 * 1000;

// Тег темы у поста в Threads. У нас он был «шабашка» с самого начала — первым
// хештегом в тексте, — и именно с ним лента набирает свои миллионы просмотров,
// так что менять его без причины незачем. Теперь он уходит отдельным полем
// (см. cleanTag в threads.js), а текст остаётся без хвоста из решёток.
// THREADS_TOPIC_TAG=off — посты без тега.
const THREADS_TOPIC_TAG = video.optional('THREADS_TOPIC_TAG', 'шабашка');

// Каким объявлениям в Threads идёт картинка-карточка. Обычные объявления уходят
// текстом: так они и набирают просмотры, и менять работающее незачем. Рекламе —
// карточка: за неё платят, чтобы её заметили, а картинку в ленте замечают
// раньше текста. all — карточка у всех, none — ни у кого.
const THREADS_CARDS = (process.env.THREADS_CARDS || 'ads').trim();

// Ни ролик, ни пост в Threads не уезжают в тот же момент, когда админ прислал
// объявление: ролик надо собрать и дождаться обработки у Meta, пост — своей
// очереди. Отчитаться ответом на сообщение поэтому нельзя. Кто отчитается,
// решает вызывающий: social ничего не знает про Telegram.
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
const queued = () => [...waiting.values()].reduce((n, q) => n + q.length, 0);
// Разбивка по типам для /stats: пустые очереди не показываем — «заказы 0»
// ничего не сообщает, а строку занимает.
const queuedByType = () =>
  [...waiting].map(([listingType, q]) => ({ listingType, count: q.length })).filter((q) => q.count);

// Meta считает вызовы Graph API на час вперёд для всего приложения, а не по
// ролику: один Reels — это уже три десятка запросов (создание контейнера,
// опрос статуса раз в несколько секунд почти две минуты, публикация). Если
// админ разбирает пачку скриншотов, ролики раньше уходили в Instagram и
// Threads параллельно и быстро упирались в «Application request limit
// reached». Через очередь с паузой они идут по одному, и лимит набирается
// медленнее. Очередь — цепочка промисов в памяти процесса, ничего не хранит.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Очередь с минимальным промежутком между заданиями — список в памяти процесса,
// ничего не хранит. У каждой площадки своя: полторы минуты для Instagram
// считают часовой лимит Graph API, десять минут для Threads — его антиспам, и
// ролик не должен стоять за текстовым постом.
//
// Список, а не цепочка промисов, как было раньше: платная реклама (см. /ad в
// bot.js) должна вставать перед теми, кто ещё ждёт, а в цепочку встроиться
// посередине нельзя — её порядок задан навсегда в момент добавления.
function pacer(minIntervalMs) {
  const tasks = [];
  let running = false;
  let lastStartedAt = 0;

  async function drain() {
    running = true;
    while (tasks.length) {
      // Пауза до того, как взяли задание, а не после: за эти минуты может
      // прийти реклама, и уйти должна она, а не тот, кого выбрали раньше.
      const wait = minIntervalMs - (Date.now() - lastStartedAt);
      if (wait > 0) await sleep(wait);
      const task = tasks.shift();
      lastStartedAt = Date.now();
      try {
        task.resolve(await task.fn());
      } catch (err) {
        // Ошибка одного задания не должна обрывать очередь для следующих за ним.
        task.reject(err);
      }
    }
    running = false;
  }

  const schedule = (fn, { priority = false } = {}) => {
    const task = { fn };
    const promise = new Promise((resolve, reject) => {
      task.resolve = resolve;
      task.reject = reject;
    });
    // Перед ждущими, но не перед тем, что уже уехало на площадку: отменить
    // начатую отправку нельзя.
    tasks.splice(priority ? 0 : tasks.length, 0, task);
    if (!running) drain();
    return promise;
  };
  // Сколько заданий ещё не начинали выполняться, включая только что добавленное.
  schedule.queued = () => tasks.length;
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
    // id отдаём наверх, а не только в лог: по нему потом снимают объявление,
    // когда автор нашёл работника (см. imports.setPosts).
    return { posted: true, id };
  } catch (err) {
    console.log(`[${label}] не вышло: ${err.message}`);
    // code нужен запасному ходу с картинкой: по нему видно, дело в самом ролике
    // или в аккаунте — во втором случае картинка не пройдёт тем более.
    return { posted: false, reason: err.message, hardLimit: net.isHardLimit(err), code: err.code };
  }
}

// Задания, которые ушли не везде: по ним админ может нажать в боте «попробовать
// ещё раз». Держим в памяти вместе с самим mp4 — собирать его заново было бы
// минуту работы и лишний расход, а весит он пару сотен килобайт. Перезапуск
// процесса всё это теряет, и это нормально: кнопка просто скажет, что ролик
// выветрился, а сам ролик у админа уже есть в чате.
//
// Двенадцать часов, а не сорок минут, как было сначала: Instagram на частых
// публикациях отвечает «User is performing too many actions», и это не сбой, а
// троттлинг на часы. За сорок минут он не отпускал, задание выветривалось, и
// объявление приходилось искать и выкладывать заново руками — ровно то, чего
// автоповторы должны избавлять. Расписание самих попыток — в telegram/bot.js;
// оттуда же и двенадцать часов: упёршись в суточную норму, бот ждёт десять и
// пробует снова, и задание должно дожить до этого момента с запасом. Срок
// продлевается на каждой неудачной попытке — цепочка из нескольких ожиданий
// живёт, пока сами попытки идут.
const RETRY_TTL_MS = 12 * 60 * 60 * 1000;
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
// объявление пришло: перед ним в очереди публикаций может стоять другой ролик,
// и держать всё это время готовый mp4 в памяти незачем. Логи по этапам: на
// бесплатном Render процесс может умереть посередине (сон сервиса или нехватка
// памяти), и тогда молчание в чате — единственный симптом. По последней строке
// в логах видно, на чём именно оборвалось.
async function buildVideo(job) {
  console.log(`[видео] сборка ролика: объявлений ${job.items.length} — ${job.collection}`);
  // Название выпуска лежит в самом задании: у дайджеста с сайта оно своё
  // («Топ-5 вакансий · за 2 дня»), и повтор должен собрать ролик тем же.
  const { buffer, credit } = await video.build(job.items, job);
  console.log(`[видео] ролик собран: ${buffer.length} байт`);
  job.buffer = buffer;
  job.caption = video.caption(job.items, credit, job);
}

// Собирает ролик (если ещё не собран) и публикует его в Instagram. Единственная
// площадка, которой нужна очередь: у неё есть видео, которое надо закодировать
// на стороне Meta, и общий с Threads часовой лимит Graph API, который тридцать
// вызовов одного Reels выедают быстро.
// Отказ по суточной норме — отдельной функцией: до сборки и после неё причина
// одна и та же. Потолков три, и назвать надо тот, в который упёрлись: мягкий
// закрывает только ролики (дальше объявление едет картинкой), свой суточный —
// вообще всё обычное, а у платной рекламы он и вовсе площадочный (см. adLimit в
// quota.js). Упёрлись в последние два — остаётся ждать, пока окно сдвинется.
// ceiling — потолок, выше которого этому заданию уже не подняться: у обычного
// объявления свой суточный, у платной рекламы площадочный.
function quotaFailure(ceiling = quota.hardLimit()) {
  const used = quota.used();
  const free = quota.freeAt(ceiling);
  // Часовой пояс называем явно: Render живёт по UTC, и без него срок уезжал на
  // шесть часов назад — в чат приходило «освободится к 19:03» в час ночи.
  const when = free
    ? `, место освободится к ${free.toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' })}`
    : '';
  return {
    posted: false,
    reason:
      used >= ceiling
        ? `суточная норма Instagram выбрана целиком: ${used} из ${ceiling}${when}`
        : `норма на ролики выбрана: ${used} из ${quota.dailyLimit()}${when}`,
  };
}

// Норма занята, а объявление платное: ролик всё равно собираем и оставляем в
// задании — из него его заберёт отчёт и отдаст админу в чат готовым mp4
// (см. reportReel в telegram/bot.js), чтобы рекламу можно было выложить руками,
// не дожидаясь, пока окно сдвинется. Раньше до сборки в этом случае просто не
// доходило, и в чат приходила одна строка об отказе — выкладывать было нечего.
// Только для рекламы: собирать минуту ffmpeg на бесплатном Render ради ролика,
// которого никто не просил, незачем.
async function buildForHand(job, failure) {
  if (!job.priority || job.buffer) return failure;
  try {
    await buildVideo(job);
  } catch (err) {
    console.log(`[видео] для ручной публикации не собрался: ${err.message}`);
  }
  return failure;
}

async function deliverInstagram(job) {
  const base = backendUrl();
  if (!base) return { posted: false, reason: 'не задан адрес бэкенда' };

  // Сколько мест в сутках осталось на самом деле, знает Instagram: он считает и
  // публикации руками из приложения, и всё, что мы сделали до перезапуска
  // процесса. Спрашиваем перед каждым роликом — на фоне трёх десятков вызовов,
  // которых стоит сам Reels, один лишний ничего не значит.
  await quota.sync(instagram.publishingLimit);

  // Под каким потолком идём: платная реклама — под площадочным, обычное
  // объявление — под мягким, из-под которого оно ещё может уехать картинкой.
  const ceiling = job.priority ? quota.adLimit() : quota.hardLimit();
  const limit = job.priority ? ceiling : quota.dailyLimit();

  // Место в квоте сначала только смотрим, не занимая: если его нет, ролик и
  // собирать незачем — минута ffmpeg на бесплатном Render уйдёт впустую, — и
  // объявление сразу едет картинкой. Ей место найдётся: у картинки потолок выше
  // (см. hardLimit в quota.js), а стоит она два вызова Graph API вместо трёх
  // десятков.
  if (!quota.left(limit)) {
    const failure = await withImageFallback(job, quotaFailure(ceiling));
    return failure.posted ? failure : buildForHand(job, failure);
  }

  if (!job.buffer) {
    try {
      await buildVideo(job);
    } catch (err) {
      // Сборка — такой же повторяемый шаг, как и публикация: «fetch failed»
      // здесь почти всегда сетевой сбой на музыке или шрифте и сам проходит
      // через несколько минут. Объявления к этому моменту уже на сайте, в
      // Telegram и в Threads — терять Instagram насовсем незачем.
      console.log(`[видео] не собрался: ${err.message}`);
      return withImageFallback(job, { posted: false, reason: `ролик не собрался: ${err.message}` });
    }
  }

  // Место занимаем здесь, вплотную к созданию контейнера: именно контейнер
  // Instagram и считает, и списывать единицу за сборку, которая до Meta могла и
  // не дойти, нельзя. Сборка идёт минуту с лишним — за это время место мог
  // занять другой ролик, поэтому проверяем ещё раз, и снова с той же развилкой
  // на картинку.
  if (!quota.take(limit)) {
    // Ролик к этому моменту уже собран — buildForHand его не тронет, но и не
    // помешает: отдать админу нужно ровно то же самое.
    const failure = await withImageFallback(job, quotaFailure(ceiling));
    return failure.posted ? failure : buildForHand(job, failure);
  }

  // Ссылку выкладываем заново на каждой попытке: с прошлого раза файл мог
  // выветриться из hosting.
  const url = `${base}/api/social/video/${hosting.put(video.fileName(), job.buffer)}`;
  console.log(`[видео] отдаю ссылку ${url}`);
  const result = await post('insta', () => instagram.publishReel(url, job.caption, video.COVER_MS));
  return result.posted ? result : withImageFallback(job, result);
}

// Ролик не доехал — пробуем то же объявление обычным постом с картинкой.
// Причин у ролика отказать много: на бесплатном Render ffmpeg умирает по памяти,
// Meta может забраковать или не успеть обработать само видео, а может просто не
// оказаться места в суточной норме. Объявление из-за этого не должно пропасть из
// ленты совсем: карточка рисуется тем же макетом (см. renderStill в card.js),
// подпись остаётся той же, а ни кодирования, ни обработки на стороне Instagram
// картинке не нужно — то есть отпадает ровно то, на чём ролик и споткнулся.
async function withImageFallback(job, failure) {
  // Упор в суточный потолок площадки (2207042) и мёртвый токен (190) картинка не
  // обойдёт: она идёт тем же Graph API от того же аккаунта. Лишняя попытка тут
  // не спасёт объявление, а место в квоте спишет.
  if (failure.hardLimit || failure.code === 190) return failure;

  // Кадр показывает одно объявление. В дайджесте с сайта их пять, в обычном
  // выпуске — до трёх, и подменять такой ролик одной карточкой — врать и
  // подписью, и содержимым. Пачка из нескольких объявлений поэтому запасного
  // хода не имеет: если ролик не доехал, её вытянут автоповторы
  // (см. AUTO_RETRY_DELAYS в telegram/bot.js), а объявления к этому моменту
  // уже на сайте, в канале и в Threads. Сделать тут по-честному можно было бы
  // каруселью из нескольких картинок — это отдельная работа с Graph API.
  if (job.items.length !== 1) return failure;

  const base = backendUrl();
  if (!base) return failure;

  // Место в квоте — как и у ролика, вплотную к созданию контейнера: Instagram
  // считает именно контейнеры, и неудачная попытка списывает столько же, сколько
  // удачная. Потолок здесь настоящий, а не мягкий: запасной ход и нужен для
  // случая, когда обычного места уже не осталось. У платной рекламы он ещё выше —
  // площадочный, свой суточный её не держит (см. adLimit в quota.js).
  if (!quota.take(job.priority ? quota.adLimit() : quota.hardLimit())) return failure;

  let image;
  try {
    image = await card.renderStill(job.items[0], job);
  } catch (err) {
    console.log(`[картинка] не нарисовалась: ${err.message}`);
    return failure;
  }

  // Подпись собираем свою, а не берём job.caption от ролика: во-первых, ролика
  // могло не быть вовсе (места в норме не нашлось — до сборки не дошли), а
  // во-вторых, у картинки нет музыки, и называть в подписи автора трека, которого
  // в посте не звучит, незачем — отсюда credit = null.
  const caption = video.caption(job.items, null, job);

  const url = `${base}/api/social/image/${hosting.put(card.stillName(), image)}`;
  console.log(`[картинка] ролик не вышел (${failure.reason}) — отдаю ссылку ${url}`);
  const result = await post('insta', () => instagram.publishImage(url, caption));

  // Не вышло и картинкой — наверх уходит исходная причина отказа ролика: повтор
  // должен заниматься тем же, чем занимался бы без запасного хода. Про картинку
  // дописываем отдельно, иначе в отчёте стояла бы одна ошибка ролика, а в логах
  // — две попытки, и понять, что происходило, стало бы не по чему.
  if (!result.posted) {
    return { ...failure, reason: `${failure.reason}; картинкой тоже не вышло: ${result.reason}` };
  }
  return { ...result, asImage: true, videoReason: failure.reason };
}

function scheduleInstagram(job, priority = false) {
  return schedule(async () => {
    inFlight += 1;
    try {
      return await deliverInstagram(job);
    } finally {
      inFlight -= 1;
    }
  }, { priority });
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
    result.threads = await paceThreads(() => post('threads', () => publishToThreads(job.threadsItem)), {
      priority: Boolean(job.priority),
    });
  }
  // Ролика может не быть вовсе: первая попытка могла оборваться ещё на сборке.
  // Пересоберёт его deliverInstagram — там же, где он и нужен.
  // priority у повтора тот же, что и у первой попытки: платное объявление не
  // должно терять место в голове очереди только потому, что площадка отбила
  // его с первого раза, — оно и так вышло позже всех.
  if (job.targets.includes('instagram')) {
    result.instagram = await scheduleInstagram(job, job.priority);
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

// Собирает и выкладывает ролик по забранной из очереди пачке. Вызывается не из ответа
// на сообщение, а сама по себе, — поэтому отчитывается через reelHandler.
// opts подменяет название выпуска (см. createRenderer в card.js): пусто —
// обычные «Заказы дня», у дайджеста с сайта — свои заголовок, число и концовка.
async function runBatch(entries, opts = {}) {
  const job = {
    items: entries.map(({ ctx, priority, ...item }) => item),
    listingType: entries[0].listingType,
    collection: opts.collection || card.collectionTitle(entries[0].listingType, entries.length),
    day: opts.day,
    cta: opts.cta,
    digest: Boolean(opts.digest),
    targets: ['instagram'],
    // Платное объявление в пачке. Нужно не только для места в очереди, но и
    // для отказа по норме: рекламе ролик собирают даже тогда, когда публиковать
    // его некуда, — чтобы админ выложил руками (см. buildForHand).
    priority: entries.some((entry) => entry.priority),
    // Ролик целиком рекламный — подпись начинается с пометки (см. adLine в
    // video.js). Реклама едет своим роликом, без попутчиков (см. shareListing),
    // так что смешанной пачки здесь не бывает.
    ad: entries.length > 0 && entries.every((entry) => entry.priority),
  };
  // Реклама едет вперёд остальных: между публикациями в Instagram полторы
  // минуты, и в тихий день их не видно, а на пачке скриншотов платное
  // объявление иначе стояло бы за всеми.
  const instagramResult = await scheduleInstagram(job, job.priority);
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

// Ролик выходит по часам, а не по наполнению очереди (см. RELEASE_INTERVAL_MS).
// За один раз — одна пачка, и берём её у того типа, чьё объявление ждёт дольше
// всех: иначе оживлённая очередь заказов не давала бы выйти единственной за
// день вакансии. Неполная пачка уезжает так же, как полная, — в этом и смысл
// расписания: ничто не ждёт компанию дольше своего срока.
//
// Намеренно без await: сборка и обработка на стороне Meta занимают минуты, а
// таймер должен вернуться сразу.
function release() {
  dropStale();
  const queues = [...waiting.values()].filter((q) => q.length);
  if (!queues.length) return 0;
  // Платное объявление ставится в голову своей очереди (см. shareListing), так
  // что по первому элементу видно и срочность, и возраст.
  queues.sort((a, b) => (b[0].priority ? 1 : 0) - (a[0].priority ? 1 : 0) || a[0].at - b[0].at);
  const entries = queues[0].splice(0, BATCH_SIZE);
  runBatch(entries).catch((err) => console.error('Автопостинг (ролик):', err));
  return entries.length;
}

// Расписание живёт, пока жив процесс. Перезапуск Render теряет вместе с ним и
// саму очередь — объявления из неё к этому моменту уже на сайте, в канале и в
// Threads, так что терять нечего.
let releaseTimer = null;

function startReleases() {
  if (releaseTimer || !instagram.isConfigured()) return;
  releaseTimer = setInterval(release, RELEASE_INTERVAL_MS);
  // Таймер не должен сам по себе держать процесс живым: его держит express.
  releaseTimer.unref();
  console.log(
    `[очередь роликов] выпуск раз в ${Math.round(RELEASE_INTERVAL_MS / 60000)} мин, до ${BATCH_SIZE} объявлений в ролике`
  );
}

// Сколько минут до ближайшего выпуска — для ответа в чат. Точность тут не
// важна: человеку нужно понять, ждать ему минуты или часы.
function nextReleaseInMin() {
  if (!releaseTimer) return 0;
  return Math.max(1, Math.round(RELEASE_INTERVAL_MS / 60000));
}

// Выпускает ролик из того, что уже стоит в очереди, не дожидаясь полной пачки.
// При BATCH_SIZE = 1 очередь пуста почти всегда — объявление забирают сразу, — и
// команда нужна разве что когда ролик не уехал по сбою. Смысл она сохраняет на
// случай возврата к пачкам: тогда тип, которого приходит по одному в день, снова
// не доедет до Instagram сам, и админ скажет «выпускай что есть».
//
// Возвращает, сколько объявлений уехало, — 0 значит «очередь этого типа пуста».
function flushNow(listingType) {
  dropStale();
  const q = queueFor(listingType);
  if (!q.length) return 0;
  // Больше пачки не берём даже по команде: BATCH_SIZE — это не только квота, но
  // и длина ролика, а лишнее пусть дожидается своего выпуска.
  const entries = q.splice(0, BATCH_SIZE);
  // Намеренно без await, как и в flush: сборка и обработка на стороне Meta —
  // это минуты, а ответить на команду надо сразу.
  runBatch(entries).catch((err) => console.error('Автопостинг (ролик по команде):', err));
  return entries.length;
}

// Ролик-дайджест: подборка уже опубликованного с сайта (см. digestRepo), а не
// того, что админ только что прислал. В очередь по типу не встаёт — она копит
// новые объявления, а здесь пачка готова целиком, — но дальше едет ровно той же
// дорогой: та же очередь публикаций, та же суточная квота, тот же отчёт через
// onReel и та же кнопка повтора. Возвращает false, если Instagram не настроен:
// собирать ролик, которому некуда ехать, незачем.
function shareDigest(items, opts, ctx) {
  if (!instagram.isConfigured()) return false;
  const entries = items.map((item) => ({ ...item, ctx }));
  // Намеренно без await: сборка пяти карточек и обработка на стороне Meta —
  // это минуты, а ответить на нажатие кнопки надо сразу.
  runBatch(entries, { ...opts, digest: true }).catch((err) =>
    console.error('Автопостинг (дайджест):', err)
  );
  return true;
}

// Готовая реклама: ролик или картинку прислали уже собранными (см. publishRawAd
// в telegram/bot.js), и наше дело — только довезти их до площадки. Ни сборки, ни
// макета, ни очереди по типам здесь нет: собирать нечего, а подпись «Заказ дня»
// на чужом ролике была бы враньём.
//
// Место в суточной норме берём по потолку площадки: свой суточный потолок
// придерживает обычные объявления, чтобы лента не превращалась в поток, а за
// рекламу заплатили — ждать сутки она не должна (см. adLimit в quota.js).
async function deliverRawMedia(job) {
  const base = backendUrl();
  if (!base) return { posted: false, reason: 'не задан адрес бэкенда' };

  await quota.sync(instagram.publishingLimit);
  if (!quota.take(quota.adLimit())) return quotaFailure(quota.adLimit());

  const isVideo = job.kind === 'video';
  // Instagram приходит за файлом сам, по ссылке: выкладываем наружу на двадцать
  // минут тем же способом, что и собранные ролики.
  const name = hosting.put(isVideo ? video.fileName() : `ad-${Date.now().toString(36)}.jpg`, job.buffer);
  const url = `${base}/api/social/${isVideo ? 'video' : 'image'}/${name}`;
  console.log(`[реклама] отдаю ссылку ${url}`);

  return post('insta', () =>
    isVideo
      ? instagram.publishReel(url, job.caption, video.COVER_MS)
      : instagram.publishImage(url, job.caption)
  );
}

// Реклама «как есть» на площадки. Возвращает расписку о приёме и обещание
// (done), которое сбудется, когда Instagram ответит: между публикациями
// полторы минуты, столько ждать ответом на сообщение нельзя.
//
// text — подпись рекламодателя, siteLink — адрес карточки на сайте. Подписи
// собираются здесь, для каждой площадки своя: Instagram берёт её целиком, а в
// Threads влезает пятьсот знаков (см. threadsCaption в video.js).
function shareMedia({ kind, buffer, text = '', siteLink = '', title = 'реклама' }, ctx, { priority = false } = {}) {
  const skipped = [];
  const result = { skipped, done: Promise.resolve(null) };
  const ad = Boolean(priority);

  // Раньше в Threads уходила одна подпись, текстом: «картинок он от нас не
  // принимает». Принимает — и для рекламы это главное: за неё платят, чтобы её
  // увидели, и ролик или макет рекламодателя должны выйти там такими, какими
  // их прислали. Рекламу у Шабашки заказывают именно в Threads.
  if (!threads.isConfigured()) skipped.push('threads');
  else {
    result.threadsQueued = true;
    result.threadsWaiting = scheduleThreads(
      { text: video.threadsCaption(text, siteLink, { ad }), media: { kind, buffer } },
      title,
      { ...ctx, ad },
      priority
    );
  }

  if (!instagram.isConfigured()) {
    skipped.push('instagram');
    return result;
  }

  const caption = [ad && video.adLine(), text, siteLink].filter(Boolean).join('\n\n').trim();
  result.instagramQueued = true;
  result.caption = caption;
  result.done = schedule(
    async () => {
      inFlight += 1;
      try {
        return await deliverRawMedia({ kind, buffer, caption });
      } finally {
        inFlight -= 1;
      }
    },
    { priority }
  );
  return result;
}

// Один пост в Threads: текстом, картинкой или роликом. Файл выкладываем наружу
// здесь, вплотную к публикации, а не когда объявление встало в очередь: между
// постами до десяти минут, а ссылка живёт двадцать (см. hosting.js), и перед
// рекламой в очереди может стоять несколько других.
//
// Не вышло с файлом — пробуем тем же текстом: реклама без картинки лучше, чем
// реклама, которой нет. Упор в антиспам (подкод 2207051) не обходим — вторая
// попытка его только продлит.
async function publishToThreads(item) {
  const opts = { topicTag: THREADS_TOPIC_TAG };
  const base = backendUrl();

  let media = null;
  if (base && item.media && item.media.buffer) {
    const isVideo = item.media.kind === 'video';
    const name = hosting.put(isVideo ? video.fileName() : card.stillName(), item.media.buffer);
    media = { isVideo, url: `${base}/api/social/${isVideo ? 'video' : 'image'}/${name}` };
  } else if (base && item.card) {
    try {
      const image = await card.renderStill(item.card, {});
      media = { isVideo: false, url: `${base}/api/social/image/${hosting.put(card.stillName(), image)}` };
    } catch (err) {
      console.log(`[threads] карточка не нарисовалась (${err.message}) — пост уйдёт текстом`);
    }
  }

  if (media) {
    try {
      return media.isVideo
        ? await threads.publishVideo(media.url, item.text, opts)
        : await threads.publishImage(media.url, item.text, opts);
    } catch (err) {
      if (net.isHardLimit(err) || !item.text) throw err;
      console.log(`[threads] с ${media.isVideo ? 'роликом' : 'картинкой'} не вышло (${err.message}) — публикую текстом`);
    }
  }
  return threads.publishText(item.text, opts);
}

// Ставит пост в очередь Threads и отчитывается сам, когда до него дошло: между
// постами до десяти минут, столько ждать ответом на сообщение нельзя.
// item — { text, media?: { kind, buffer }, card?: { parsed, listingType } }.
// Текст уходит в отчёт: по нему рекламу потом можно выложить ещё раз
// (см. adTracker.js).
function scheduleThreads(item, title, ctx, priority = false) {
  paceThreads(() => post('threads', () => publishToThreads(item)), { priority })
    .then(async (result) => {
      const retryId = result.posted ? null : remember({ threadsItem: item, priority }, ['threads']);
      if (threadsHandler) await threadsHandler({ ...result, title, ctx, retryId, text: item.text });
    })
    .catch((err) => console.error('Автопостинг (threads):', err));
  return paceThreads.queued();
}

// Пост только в Threads — для повтора рекламы, которая недобирает просмотры
// (см. кнопку «поднять» в telegram/bot.js). В Instagram повтор не идёт: там у
// нас потолок постов в сутки, а гарантию просмотров мы даём по Threads.
function postToThreads(item, title, ctx, { priority = true } = {}) {
  if (!threads.isConfigured()) return null;
  return scheduleThreads(item, title, ctx, priority);
}

// Объявление уходит в Threads по одному и текстом, а в очередь на ролик — ждать
// компанию. Threads пачками не собираем: своей квоты Instagram он не тратит,
// лимиты у него заметно щедрее, и отдельными постами объявление и находят
// чаще, и появляется оно там раньше.
// priority — платная реклама (/ad в боте): ставим её перед теми, кто ещё ждёт
// своей очереди на площадку. Промежутки между постами при этом не трогаем —
// они защищают от антиспама Threads и от часового лимита Instagram, и обгонять
// их нельзя никому.
async function shareListing(parsed, listingType, siteLink, ctx, { priority = false } = {}) {
  const skipped = [];
  const result = { threads: null, skipped, batchSize: BATCH_SIZE };

  if (threads.isConfigured()) {
    const text = video.threadsText(parsed, listingType, siteLink, { ad: priority });
    const withCard = THREADS_CARDS === 'all' || (THREADS_CARDS === 'ads' && priority);
    result.threadsQueued = true;
    result.threadsWaiting = scheduleThreads(
      { text, card: withCard ? { parsed, listingType } : null },
      parsed.title,
      // card в ctx — чтобы повтор рекламы (кнопка «поднять») вышел таким же
      // постом, как первый: с той же карточкой или тем же текстом.
      { ...ctx, ad: priority, card: withCard ? { parsed, listingType } : null },
      priority
    );
  } else {
    skipped.push('threads');
    console.log('[threads] не настроен — пропускаю');
  }

  if (instagram.isConfigured()) {
    // at — когда объявление встало в очередь: по нему выбирается, чья пачка
    // выезжает следующей, и по нему же очередь чистится от просроченных.
    const entry = { parsed, listingType, siteLink, ctx, priority, at: Date.now() };
    // Реклама едет своим роликом, без попутчиков и без расписания: за неё
    // заплатили, и ни ждать два с половиной часа, ни делить ролик с чужими
    // объявлениями она не должна — рекламодатель платит за свой пост.
    if (priority) runBatch([entry]).catch((err) => console.error('Автопостинг (реклама):', err));
    else queueFor(listingType).push(entry);
    result.queued = true;
    // Название с оглядкой на размер пачки: ролик из одного объявления называется
    // «Вакансия дня», и обещать в ответе «Вакансии дня» нельзя — в Instagram
    // уедет не то, что написано в чате.
    result.collection = card.collectionTitle(listingType, BATCH_SIZE);
  } else {
    skipped.push('instagram');
    console.log('[instagram] не настроен — пропускаю');
  }

  // Ненастроенную площадку раньше пропускали молча — и молчание нельзя было
  // отличить от «всё хорошо». Отдаём её наверх отдельно от провалов: повторять
  // тут нечего, дело не в сбое, а в незаданных переменных окружения.
  if (skipped.length === 2) result.reason = 'Ни Threads, ни Instagram не настроены';

  // Сколько объявлений этого типа ждёт ролика вместе с этим и когда выйдет
  // ближайший: объявление больше не уезжает в ту же секунду, и сказать об этом
  // надо прямо, иначе молчание Instagram читается как сбой.
  result.waiting = queueFor(listingType).length;
  result.releaseInMin = nextReleaseInMin();

  // Реклама уже уехала сама (см. выше) — ни очереди, ни расписания у неё нет.
  if (priority) {
    result.waiting = 0;
    result.releaseInMin = 0;
  }

  return result;
}

// Настоящие суточные нормы обеих площадок — для команды /limits в боте. Числа
// считает Meta, а не мы, и у каждой площадки они свои: у Instagram сотня на все
// публикации разом (ролики, картинки, карусели — один общий счётчик), у Threads
// двести пятьдесят только на посты. Ходим сюда по требованию: коду это не нужно,
// нужно человеку.
//
// Отказ одной площадки не должен прятать числа другой, поэтому ошибку каждой
// заворачиваем отдельно; ненастроенная площадка отдаёт null — про неё в отчёте
// сказать нечего.
// Подтянуть в счётчик настоящее число публикаций — для /stats. Показывать там
// догадку, когда точное число стоит одного вызова, незачем; ошибку sync глотает
// сам и оставляет прежний счётчик.
const syncQuota = () => quota.sync(instagram.publishingLimit);

async function limits() {
  const ask = (platform) =>
    platform.isConfigured()
      ? platform.publishingLimit().catch((err) => ({ error: err.message }))
      : null;
  const [ig, th] = await Promise.all([ask(instagram), ask(threads)]);
  return { instagram: ig, threads: th };
}

// Снять объявление с площадок. Зовётся, когда автор нашёл работника и попросил
// убрать объявление: висит оно в четырёх местах сразу, и снятое с одного сайта
// по-прежнему приводит людей к закрытой вакансии.
//
// В Threads пост удаляем сами. Ролик в Instagram — нет: удаление медиа Meta даёт
// только приложениям на Facebook Login с разрешением instagram_manage_contents,
// а мы работаем через Instagram Login. Поэтому возвращаем ссылку на пост — в
// приложении это два касания вместо поисков ролика в ленте.
//
// Ни один отказ не считается провалом всего снятия: с сайта объявление к этому
// моменту уже убрано, и оборванный запрос к Meta не повод об этом молчать.
async function unpublish({ threadsPostId, instagramMediaId }) {
  const result = { threads: null, instagram: null };

  if (threadsPostId && threads.isConfigured()) {
    try {
      await threads.remove(threadsPostId);
      result.threads = { removed: true };
    } catch (err) {
      result.threads = { removed: false, reason: err.message };
    }
  }

  if (instagramMediaId && instagram.isConfigured()) {
    try {
      result.instagram = { link: await instagram.permalink(instagramMediaId) };
    } catch (err) {
      result.instagram = { link: '', reason: err.message };
    }
  }

  return result;
}

module.exports = {
  shareListing,
  shareMedia,
  postToThreads,
  unpublish,
  shareDigest,
  flushNow,
  startReleases,
  release,
  nextReleaseInMin,
  limits,
  syncQuota,
  retry,
  onReel,
  onThreads,
  pending,
  queued,
  queuedByType,
  collectionTitle: card.collectionTitle,
  threadsQueued: () => paceThreads.queued(),
  quota,
  tokens,
  adTracker,
  leads,
  threadsConfigured: () => threads.isConfigured(),
  adLine: () => video.adLine(),
  accountInsights: (range) => threads.accountInsights(range),
  isPermissionError: (err) => threads.isPermissionError(err),
  BATCH_SIZE,
  RELEASE_INTERVAL_MIN: Math.round(RELEASE_INTERVAL_MS / 60000),
  THREADS_INTERVAL_MIN: Math.round(THREADS_INTERVAL_MS / 60000),
  router: hosting.router,
};

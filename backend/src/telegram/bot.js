const { domainToUnicode } = require('url');

const tg = require('./api');
// Кто имеет право публиковать через бота. Список общий с уведомлениями о жалобах
// (см. notify.js): это те же люди и тот же чат.
const { ADMIN_IDS, isAllowed } = require('./notify');
const extract = require('./extract');
const imports = require('./imports');
const queue = require('./queue');
const social = require('../social');
const digestRepo = require('../digestRepo');
const { money } = require('../money');
const EMPLOYMENT_TYPES = require('../employmentTypes');
const EXPERIENCE_LEVELS = require('../experienceLevels');

const EMPLOYMENT_LABELS = Object.fromEntries(EMPLOYMENT_TYPES.map((t) => [t.value, t.label]));
const EXPERIENCE_LABELS = Object.fromEntries(EXPERIENCE_LEVELS.map((t) => [t.value, t.label]));

const SITE_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
// Публичный канал, куда бот сам постит опубликованные объявления. Не задан —
// просто пропускаем этот шаг, остальная публикация работает как раньше.
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '';

const LISTING_PATHS = { vacancy: 'vacancies', order: 'orders' };

// Текст объявления для публикации — без внутренних пометок вроде ⚠️ note,
// которые имеют смысл только админу. Возвращает обычный текст без HTML-разметки:
// caller сам решает, экранировать его для Telegram или взять как есть
// для wa.me-ссылки.
// Домен у сайта кириллический, и в ссылке он лежит в punycode-виде
// (xn--80aaac0cyed.com) — так его понимают DNS и браузеры. Читать такое человеку
// невозможно, поэтому во всех текстах показываем развёрнутый адрес без схемы:
// «шабашка.com/orders/131». Кликабельность от этого не страдает — в Telegram
// ссылка уходит настоящим тегом со ссылкой на исходный адрес, а WhatsApp и
// Threads сами делают кликабельным домен без «https://».
function prettyLink(link) {
  if (!link) return '';
  try {
    const u = new URL(link);
    // Якорь оставляем: у записки на доске своей страницы нет, и адрес без #p12
    // привёл бы в общую ленту вместо конкретного объявления.
    return `${domainToUnicode(u.host)}${u.pathname}${u.search}${u.hash}`.replace(/\/$/, '');
  } catch {
    return link;
  }
}

function publicText(parsed, listingType, siteLink) {
  const isVacancy = listingType === 'vacancy';
  const isBoard = listingType === 'board';
  const label = isVacancy ? '💼 Вакансия' : isBoard ? '📌 Объявление' : '🧰 Заказ';
  const lines = [`${label}: ${parsed.title || 'Без заголовка'}`, ''];

  // У записки на доске нет категории — там остаётся один город
  const meta = (isBoard ? [parsed.city] : [parsed.category, parsed.city]).filter(Boolean).join(' · ');
  if (meta) lines.push(meta);
  if (isVacancy) {
    const empExp = [EMPLOYMENT_LABELS[parsed.employment_type], EXPERIENCE_LABELS[parsed.experience]]
      .filter(Boolean)
      .join(' · ');
    if (empExp) lines.push(empExp);
  }
  if (parsed.address) lines.push(`📍 ${parsed.address}`);
  if (parsed.budget) lines.push(`💰 ${money(parsed.budget)} сом${isVacancy ? ' (от)' : ''}`);
  if (parsed.phone) lines.push(`📞 ${parsed.phone}`);
  if (parsed.work_format === 'online') lines.push('💻 Удалённо');
  if (parsed.description) lines.push('', parsed.description);
  if (siteLink) lines.push('', siteLink);

  return lines.join('\n');
}

// Обрезаем длинное описание: в сообщение Telegram влезает 4096 символов, и
// один разговорчивый заказ не должен ронять всю карточку ошибкой 400. Режем до
// экранирования — иначе можно разрубить пополам «&amp;» и получить битый HTML.
function clamp(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

// Соцсети публикуются уже после того, как объявление ушло на сайт: Threads —
// почти сразу, текстом, а Instagram — с задержкой, ему нужен ролик, а
// кодирование и обработка на стороне Meta занимают до пары минут. Держать ради
// этого подтверждение публикации было бы странно, поэтому шаг отдельный и
// отвечает своим сообщением, а провал соцсетей публикацию не отменяет.
const SITE_LABELS = { instagram: '📸 Instagram', threads: '🧵 Threads' };

function retryKeyboard(retryId) {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '🔁 Попробовать опубликовать ещё раз', callback_data: `rt:${retryId}` }]],
    },
  };
}

// Отчёт по площадкам. Ненастроенную площадку тоже называем: раньше её
// пропускали молча, и «в Threads ничего не публикуется» выглядело как сбой
// публикации, хотя дело было в незаданном токене. В провалы она не идёт —
// повторять нечего, и ролик в чат из-за неё отдавать не за чем.
function socialReport(result) {
  // Порядок — как в публикации: Threads первым, Instagram последним.
  const sites = ['threads', 'instagram'].filter((name) => result[name]);
  const failed = sites.filter((name) => !result[name].posted);
  const lines = sites
    .filter((name) => result[name].posted)
    .map((name) => `${SITE_LABELS[name]}: опубликовано`);
  for (const name of failed) lines.push(`${SITE_LABELS[name]}: ${tg.esc(result[name].reason)}`);
  // Только когда есть с чем сравнить: если не настроено вообще ничего, об этом
  // скажет result.reason, и повторять то же самое двумя строками незачем.
  if (sites.length) {
    for (const name of result.skipped || []) lines.push(`${SITE_LABELS[name]}: не настроен`);
  }
  return { sites, failed, lines };
}

// true, если хоть одна из недобитых площадок упёрлась не во временный сбой, а
// в потолок, который часами не сдвинется (суточная квота Instagram, антиспам
// Threads) — см. isHardLimit в social/net.js. Частые автопопытки тут не
// помогают, а только тратят ту же квоту или продлевают подозрение, поэтому
// такие случаи не должны попадать в обычный каскад из scheduleAutoRetry.
function hasHardLimit(result, failed) {
  return failed.some((name) => result[name] && result[name].hardLimit);
}

// Автоматические повторы, если что-то не опубликовалось: без них админу
// пришлось бы самому нажимать «Попробовать ещё раз» на каждый недобитый ролик,
// а по факту чаще всего дело во временном сбое площадки — токен протухает
// редко, а сеть или лимит Meta отпускают сами.
// Кнопка при этом никуда не девается — ей можно поторопить, не дожидаясь паузы.
//
// Пауза растёт, а не держится на пяти минутах: сетевой сбой проходит за минуты,
// а «User is performing too many actions» в Instagram — это троттлинг на часы, и
// частые попытки в него же и упираются, только тратя лимит приложения. Всего
// расписание тянется около шести часов (TTL задания в social/index.js — восемь).
const MINUTE_MS = 60 * 1000;
const AUTO_RETRY_DELAYS = [5, 10, 20, 30, 45, 60, 60, 60, 60].map((m) => m * MINUTE_MS);
const AUTO_RETRY_SPAN = 'почти шесть часов';

function scheduleAutoRetry(chatId, retryId, attempt = 0) {
  setTimeout(async () => {
    let result;
    try {
      result = await social.retry(retryId);
    } catch (err) {
      console.error('Автопостинг (авто-повтор):', err);
      return;
    }
    if (!result) return; // ролик выветрился из памяти — дальше только вручную, из сообщения выше

    const { sites, failed, lines } = socialReport(result);
    // reason — это причина, по которой до площадок вообще не дошло (ни одна не
    // настроена). Без этой строки провал выглядел бы как успех.
    if (result.reason) lines.push(`🎬 ${tg.esc(result.reason)}`);

    if (!failed.length && !result.reason) {
      if (sites.length) {
        await tg
          .sendMessage(chatId, `${sites.map((n) => SITE_LABELS[n]).join(' и ')} — опубликовано (сам, с повторной попытки)`)
          .catch(() => {});
      }
      return;
    }

    if (hasHardLimit(result, failed)) {
      // Квота или антиспам-блокировка сама за минуты не пройдёт — дальнейшие
      // попытки каждые 5-60 минут только жгли бы её впустую. Останавливаем
      // каскад сразу и оставляем ролик на ручную кнопку.
      await tg
        .sendMessage(chatId, `⏳ Упёрлись в лимит площадки, само за часы не пройдёт: ${lines.join('; ')}`)
        .catch(() => {});
      return;
    }

    if (attempt + 1 < AUTO_RETRY_DELAYS.length && result.retryId) {
      scheduleAutoRetry(chatId, result.retryId, attempt + 1);
      return;
    }

    // Автопопытки кончились — дальше только руками по кнопке в исходном сообщении.
    await tg
      .sendMessage(chatId, `⚠️ Само не получилось за ${AUTO_RETRY_SPAN}: ${lines.join('; ')}`)
      .catch(() => {});
  }, AUTO_RETRY_DELAYS[attempt]);
}

// Ни одна площадка больше не отвечает сразу: в Threads объявление уходит по
// одному, но не залпом (его антиспам ловит частоту), а в Instagram — пачкой по
// три (квота считает посты, а не объявления). Поэтому здесь только расписка о
// приёме: что куда встало в очередь. Чем кончилось, скажут отдельные сообщения
// из social.onThreads и social.onReel ниже.
async function shareToSocial(chatId, parsed, listingType, siteLink) {
  try {
    const result = await social.shareListing(parsed, listingType, siteLink, { chatId });
    const lines = [];
    if (result.reason) lines.push(`🎬 ${tg.esc(result.reason)}`);
    for (const name of result.skipped || []) lines.push(`${SITE_LABELS[name]}: не настроен`);

    if (result.threadsQueued) {
      lines.push(
        result.threadsWaiting <= 1
          ? '🧵 Threads: публикую'
          : `🧵 Threads: ${result.threadsWaiting}-й в очереди, посты идут раз в ${social.THREADS_INTERVAL_MIN} мин`
      );
    }

    if (result.queued) {
      lines.push(
        result.waiting === 0
          ? `🎬 «${tg.esc(result.collection)}» — собираю ролик`
          : `🎬 «${tg.esc(result.collection)}»: ${result.waiting} из ${social.BATCH_SIZE}`
      );
    }

    if (lines.length) await tg.sendMessage(chatId, lines.join('\n'));
  } catch (err) {
    await tg.sendMessage(chatId, `⚠️ Соцсети: ${tg.esc(err.message)}`);
  }
}

// Отчёт по посту в Threads. Как и у ролика, приходит не в ответ на объявление,
// а когда до поста дошла очередь, — поэтому называем заголовок, иначе непонятно,
// за какое из объявлений оно отчитывается.
social.onThreads(async ({ title, ctx, posted, reason, hardLimit, retryId }) => {
  const chatId = ctx && ctx.chatId;
  if (!chatId) return;
  const what = tg.esc(clamp(title || 'без заголовка', 80));

  if (posted) {
    await tg.sendMessage(chatId, `🧵 Threads — опубликовано: ${what}`).catch(() => {});
    return;
  }

  const lines = [`🧵 Threads: ${tg.esc(reason)}`, what];
  if (hardLimit) {
    lines.push('Упёрлись в антиспам Threads, само за часы не пройдёт — можно выложить вручную.');
  }
  await tg
    .sendMessage(chatId, lines.join('\n'), retryId ? retryKeyboard(retryId) : undefined)
    .catch(() => {});
  if (retryId && !hardLimit) scheduleAutoRetry(chatId, retryId);
});

// Отчёт по уехавшему ролику. Приходит не в ответ на конкретное объявление, а
// когда ролик доехал до площадки, поэтому перечисляем, что именно в него попало, —
// иначе по сообщению не понять, за какие объявления оно отчитывается.
async function reportReel(chatId, result) {
  const collection = tg.esc(result.collection || social.collectionTitle(result.listingType));
  const titles = result.items.map(
    (item, i) => `${i + 1}. ${tg.esc(clamp(item.parsed.title || 'без заголовка', 80))}`
  );

  if (result.instagram.posted) {
    // Дайджест админ заказал кнопкой и ждёт именно ролик — его отдаём и при
    // удачной публикации. Обычный выпуск собирается сам, и слать его в чат
    // каждый раз незачем: он уже в Instagram.
    if (result.digest && result.buffer) {
      await tg.sendVideo(chatId, result.buffer, clamp(result.caption, 1024)).catch(() => {});
    }
    // Ролик мог не доехать и уехать картинкой (см. withImageFallback в
    // social/index.js). Молчать об этом нельзя: в ленте это обычный пост, а не
    // Reels, и по отчёту «опубликовано» админ ждал бы ролика и пошёл бы его искать.
    const head = result.instagram.asImage
      ? [
          `📸 Instagram — опубликовано картинкой, «${collection}»`,
          `Ролик не вышел: ${tg.esc(result.instagram.videoReason)}`,
        ]
      : [`📸 Instagram — опубликовано, «${collection}»`];
    await tg.sendMessage(chatId, [...head, ...titles].join('\n')).catch(() => {});
    return;
  }

  // Не вышло — отдаём готовый mp4 с подписью, чтобы можно было выложить
  // руками. Ролика может не быть совсем, если сорвалась сборка: тогда в чат
  // отдавать нечего, но объявления уже на сайте, в Telegram и в Threads.
  // Подпись у Telegram влезает в 1024 знака, а у многословного объявления (и тем
  // более у дайджеста) она длиннее — в Instagram уходит полная, здесь начало.
  if (result.buffer) {
    await tg.sendVideo(chatId, result.buffer, clamp(result.caption, 1024)).catch(() => {});
  }

  const stuck = result.retryId && result.instagram.hardLimit;
  const lines = [`📸 Instagram, «${collection}»: ${tg.esc(result.instagram.reason)}`, ...titles];
  if (result.retryId) {
    lines.push(
      stuck
        ? 'Упёрлись в лимит площадки, само за часы не пройдёт — ролик выше, можно опубликовать вручную.'
        : result.buffer
        ? 'Бот попробует ещё раз сам. Ролик выше — можно опубликовать и вручную.'
        : 'Бот соберёт ролик заново и попробует опубликовать сам.'
    );
  }
  await tg
    .sendMessage(chatId, lines.join('\n'), result.retryId ? retryKeyboard(result.retryId) : undefined)
    .catch(() => {});
  if (result.retryId && !stuck) scheduleAutoRetry(chatId, result.retryId);
}

// Куда слать отчёт, решаем по самим объявлениям, а не по настройкам: пачка
// собирается из того, что присылали в чат, и отчёт должен вернуться туда же.
social.onReel(async (result) => {
  const chats = [...new Set((result.contexts || []).map((c) => c && c.chatId).filter(Boolean))];
  for (const chatId of chats) await reportReel(chatId, result);
});

// Повтор по кнопке. Ролик уже собран и лежит в памяти процесса, заново кодировать
// его не надо — попытка занимает столько, сколько площадка обрабатывает видео.
async function retrySocial(chatId, retryId) {
  const result = await social.retry(retryId);
  if (!result) {
    await tg.sendMessage(
      chatId,
      '🎬 Ролик уже не в памяти (прошло больше восьми часов или сервер перезапускался) — выложите его вручную из сообщения выше.'
    );
    return;
  }

  const { failed, lines } = socialReport(result);
  if (result.reason) lines.push(`🎬 ${tg.esc(result.reason)}`);

  if (!failed.length && !result.reason) {
    await tg.sendMessage(chatId, [...lines, '🔁 С повторной попытки получилось.'].join('\n'));
    return;
  }

  lines.push('Бот попробует ещё раз сам. Ролик выше — можно опубликовать и вручную.');
  await tg.sendMessage(
    chatId,
    lines.join('\n'),
    result.retryId ? retryKeyboard(result.retryId) : undefined
  );
}

// Подборка с сайта: пять случайных объявлений за двое суток одним роликом.
// Обычный выпуск собирается из того, что админ только что прислал, и в тихий
// день его просто не из чего собрать — а лента при этом пустеет. Здесь наоборот:
// берём то, что уже лежит на сайте, и зовём на сайт же концовкой.
const DIGEST_TYPES = [
  ['order', '🧰 Заказы'],
  ['vacancy', '💼 Вакансии'],
  ['board', '📌 Объявления'],
];

// Меньше трёх карточек — это не «Топ-5», а два объявления с громким заголовком.
// Такой ролик лучше не выпускать вовсе: он тратит место в суточной квоте.
const DIGEST_MIN = 3;

// Слова-синонимы /now. Набор нарочно короткий и без «давай» с «поехали»: чем
// шире список, тем выше шанс, что обычная фраза случайно выпустит ролик и
// потратит место в суточной квоте Instagram.
const FLUSH_WORDS = new Set(['выпусти', 'выпускай', 'публикуй']);

function digestMenu() {
  return {
    reply_markup: {
      inline_keyboard: [DIGEST_TYPES.map(([type, label]) => ({ text: label, callback_data: `dg:${type}` }))],
    },
  };
}

// Адрес объявления на сайте — тот же, что и в карточке после публикации:
// у записки на доске своей страницы нет, ведём на доску с якорем.
function listingLink(listingType, id) {
  if (!SITE_URL) return '';
  const path = listingType === 'board' ? `board#p${id}` : `${LISTING_PATHS[listingType]}/${id}`;
  return prettyLink(`${SITE_URL}/${path}`);
}

async function makeDigest(chatId, listingType) {
  const { items, total } = await digestRepo.pick(listingType);
  const what = digestRepo.word(listingType, 5);

  if (items.length < DIGEST_MIN) {
    await tg.sendMessage(
      chatId,
      `🎬 За ${digestRepo.DAYS} дня набралось только ${items.length} — на подборку мало. Нужно хотя бы ${DIGEST_MIN}.`
    );
    return;
  }

  const collection = digestRepo.collectionTitle(listingType, items.length);
  const started = social.shareDigest(
    items.map((item) => ({ ...item, siteLink: listingLink(item.listingType, item.id) })),
    {
      collection,
      day: digestRepo.windowLabel(),
      cta: digestRepo.cta(listingType, items.length, total),
    },
    { chatId }
  );

  if (!started) {
    await tg.sendMessage(chatId, '📸 Instagram не настроен — собирать подборку некуда.');
    return;
  }

  await tg.sendMessage(
    chatId,
    [
      `🎬 Собираю «${tg.esc(collection)}» — ${items.length} из ${total} ${tg.esc(what)} за ${digestRepo.DAYS} дня.`,
      'Ролик пришлю сюда и выложу в Instagram — это минуты.',
    ].join('\n')
  );
}

// Подписи типов для кнопок — те же, что и у подборки: пусть в боте один тип
// всегда выглядит одинаково, каким бы способом его ни выбирали.
const TYPE_LABELS = Object.fromEntries(DIGEST_TYPES);

function flushMenu(byType) {
  return {
    reply_markup: {
      inline_keyboard: [
        byType.map((q) => ({
          // Число на кнопке — не украшение: от него зависит, стоит ли выпускать
          // сейчас, и без него пришлось бы держать в голове ответ /stats.
          text: `${TYPE_LABELS[q.listingType] || q.listingType} ${q.count}`,
          callback_data: `fl:${q.listingType}`,
        })),
      ],
    },
  };
}

// Досрочный выпуск: собрать ролик из того, что уже ждёт в очереди, не дожидаясь
// полной пачки. При social.BATCH_SIZE = 1 очередь пуста почти всегда, и команда
// нужна разве что после сбоя — смысл она держит на случай возврата к пачкам.
async function flushQueue(chatId, listingType) {
  const sent = social.flushNow(listingType);
  if (!sent) {
    // Между показом кнопок и нажатием очередь могла уехать сама, набрав пачку.
    await tg.sendMessage(chatId, '🎬 Очередь уже пуста — видимо, ролик уехал сам.');
    return;
  }

  const collection = social.collectionTitle(listingType, sent);
  await tg.sendMessage(
    chatId,
    [
      `🎬 Собираю «${tg.esc(collection)}» — ${sent} ${tg.esc(digestRepo.word(listingType, sent))}.`,
      'Ролик пришлю сюда и выложу в Instagram.',
    ].join('\n')
  );
}

// Что выпускать, спрашиваем только когда ждёт больше одного типа: очередь у
// каждого типа своя, и ролик собирается из объявлений одного типа.
async function onFlushCommand(chatId) {
  const byType = social.queuedByType();

  if (!byType.length) {
    await tg.sendMessage(
      chatId,
      '🎬 Ролика никто не ждёт — очередь пуста. Пришлите скриншот или соберите подборку с сайта: /top'
    );
    return;
  }

  if (byType.length === 1) {
    await flushQueue(chatId, byType[0].listingType);
    return;
  }

  await tg.sendMessage(chatId, '🎬 Ролика ждут объявления разных типов. Что выпускаем?', flushMenu(byType));
}

// Итог дня: сколько ушло на сайт и сколько роликов ещё едет на площадки.
// Второе число живёт только в памяти процесса — после перезапуска Render оно
// честно нулевое, потому что вместе с процессом умирают и сами сборки.
async function statsText() {
  const today = await imports.countToday();
  // Очередь на ролик — по типам: ролик выходит выпуском одного типа, и общее
  // число ничего не сказало бы о том, какой выпуск вот-вот наберётся, а какой
  // стоит с одним объявлением.
  const byType = social.queuedByType();
  const waitingLine = byType.length
    ? byType
        .map((q) => `${social.collectionTitle(q.listingType).toLowerCase()} ${q.count}/${social.BATCH_SIZE}`)
        .join(', ')
    : 'пусто';
  return [
    `📊 Сегодня опубликовано: ${today}`,
    `🎬 Роликов в работе: ${social.pending()}`,
    `⏳ Ждут ролика: ${waitingLine}`,
    `🧵 Ждут очереди в Threads: ${social.threadsQueued()}`,
    // Счётчик обнуляется при перезапуске процесса, поэтому он не гарантия, а
    // подсказка: настоящую квоту Instagram считает у себя (25 за сутки).
    `📸 Публикаций в Instagram за сутки: ${social.quota.used()} из ${social.quota.DAILY_LIMIT}`,
  ].join('\n');
}

// Публикует объявление сразу, ничего не переспрашивая. Недостающие поля
// достраивает imports.applyDefaults — что именно дописали, показываем в ответе,
// чтобы подмена города или категории не прошла незамеченной.
async function publishOne(chatId, id, parsed) {
  const { parsed: ready, filled } = await imports.applyDefaults(parsed);
  if (filled.length) await imports.setParsed(id, ready);

  const result = await imports.publish(id);
  // У записки на доске отдельной страницы нет — ведём на доску с якорем: страница
  // подсветит нужное объявление, пока оно живо.
  const path = result.type === 'board' ? `board#p${result.id}` : `${LISTING_PATHS[result.type]}/${result.id}`;
  const siteLink = SITE_URL ? `${SITE_URL}/${path}` : '';
  const shown = prettyLink(siteLink);
  // Текст без ссылки: в сообщения Telegram она добавляется тегом отдельно, а в
  // WhatsApp уходит обычной строкой — разметку там показывать нечем.
  const body = publicText(ready, result.type, '');
  const publicMsg = publicText(ready, result.type, shown);
  const linkTag = siteLink ? `\n\n<a href="${siteLink}">${tg.esc(shown)}</a>` : '';

  // Канал — необязательный шаг: если пост туда не ушёл (бот не админ, канал
  // не задан), публикация на сайте всё равно должна засчитаться.
  let channelLine = '';
  if (CHANNEL_ID) {
    try {
      await tg.sendMessage(CHANNEL_ID, `${tg.esc(body)}${linkTag}`);
      channelLine = '📢 Выложено в Telegram-канал';
    } catch (err) {
      channelLine = `⚠️ В канал не ушло: ${tg.esc(err.message)}`;
    }
  }

  // wa.me/?text= открывает выбор чата в WhatsApp с готовым текстом — куда
  // отправить, решает админ: автопостинга в каналы WhatsApp у Meta нет.
  const waLink = `https://wa.me/?text=${encodeURIComponent(publicMsg)}`;

  // Показываем объявление целиком, а не одним заголовком: подтверждения перед
  // публикацией больше нет, и единственная возможность заметить, что модель
  // разобрала чужую переписку или перепутала телефон, — прочитать текст здесь,
  // рядом с кнопкой удаления.
  const isBoard = result.type === 'board';
  const lines = [
    isBoard ? '✅ Повесил на доску — сутки, потом пропадёт само' : '✅ Опубликовано',
    '',
    `${tg.esc(clamp(body, 3000))}${linkTag}`,
    '',
  ];
  if (channelLine) lines.push(channelLine);
  lines.push(`📱 <a href="${waLink}">Отправить в WhatsApp</a>`);
  if (filled.length) lines.push(`✍️ Дописал сам: ${tg.esc(filled.join(', '))}`);

  const sent = await tg.sendMessage(chatId, lines.join('\n'), {
    reply_markup: {
      inline_keyboard: [
        [{ text: isBoard ? '🗑 Снять с доски' : '🗑 Удалить с сайта', callback_data: `del:${id}` }],
      ],
    },
  });
  await imports.setCard(id, chatId, sent.message_id);

  // Намеренно без await: ролик едет своим ходом, следующее объявление из пачки
  // не должно ждать кодирования и загрузки на площадки.
  shareToSocial(chatId, ready, result.type, shown).catch((err) => console.error('Соцсети:', err));
}

async function handleParsed(chatId, listings, { source, rawText }) {
  const real = listings.filter((p) => p.is_listing && p.listing_type !== 'other');
  if (real.length === 0) {
    const note = listings[0] && listings[0].note;
    await tg.sendMessage(chatId, `🚫 Не похоже на объявление.${note ? `\n${tg.esc(note)}` : ''}`);
    return;
  }

  // По самим карточкам не видно, сколько объявлений было на скриншоте: одна
  // карточка — это и «объявление было одно», и «модель разглядела одно из пяти».
  // Строкой выше разница заметна сразу, без лазанья в логи.
  const skipped = listings.filter((p) => !real.includes(p));
  if (real.length > 1 || skipped.length) {
    const lines = [`🔍 Объявлений: ${real.length}`];
    if (skipped.length) {
      // Причины отказа показываем, а не прячем: фильтр строгий и иногда рубит
      // настоящий заказ, а заметить это можно только здесь — карточки-то нет.
      lines.push(`Пропустил ${skipped.length}:`);
      for (const p of skipped.slice(0, 5)) {
        const what = p.title || 'без названия';
        lines.push(`• ${tg.esc(what)}${p.note ? ` — ${tg.esc(p.note)}` : ''}`);
      }
      if (skipped.length > 5) lines.push(`• …и ещё ${skipped.length - 5}`);
    }
    await tg.sendMessage(chatId, lines.join('\n'));
  }

  let published = 0;
  for (const parsed of real) {
    const id = await imports.create({ source, rawText, parsed, chatId });
    if (id === null) {
      await tg.sendMessage(
        chatId,
        `♻️ «${tg.esc(parsed.title || 'без названия')}» уже приходило в этот час — пропускаю. Через час можно опубликовать заново.`
      );
      continue;
    }
    // Без номера объявлению негде получить отклик: автор — не зарегистрированный
    // пользователь, который читает свою почту на сайте, а служебный аккаунт бота,
    // а WhatsApp-ссылка ведёт в никуда без телефона. Публиковать такое некому и незачем.
    if (!parsed.phone) {
      await imports.reject(id);
      await tg.sendMessage(
        chatId,
        `🚫 «${tg.esc(parsed.title || 'без названия')}» без номера — не публикую, откликнуться было бы некуда.`
      );
      continue;
    }
    try {
      await publishOne(chatId, id, parsed);
      published += 1;
    } catch (err) {
      // Одно неудачное объявление не должно ронять всю пачку со скриншота.
      await tg.sendMessage(
        chatId,
        `⚠️ «${tg.esc(parsed.title || 'без названия')}» не опубликовалось: ${tg.esc(err.message)}`
      );
    }
  }

  if (published) await tg.sendMessage(chatId, await statsText());
}

// «через 40 секунд» / «через 3 минуты» — прикидка, а не обещание: сколько
// придётся ждать на самом деле, знает только Groq по остатку лимита.
function waitText(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes >= 2) return `≈ ${minutes} мин`;
  return `≈ ${Math.max(1, Math.round(ms / 30000)) * 30} сек`;
}

// Разбор ставим в очередь и отвечаем сразу: пачка из десятка скриншотов
// разбирается несколько минут, и держать всё это время обработчик апдейта
// нельзя — при long polling на нём встали бы и все остальные сообщения.
function enqueue(chatId, job) {
  return queue.add(async () => {
    try {
      await job();
    } catch (err) {
      console.error('Telegram queue:', err);
      await tg.sendMessage(chatId, `⚠️ Ошибка: ${tg.esc(err.message)}`).catch(() => {});
    }
  });
}

// Из скриншота берём самый крупный размер: Telegram отдаёт лесенку превью,
// а на мелком тексте объявления не разобрать.
function photoFileId(message) {
  if (Array.isArray(message.photo) && message.photo.length) {
    return message.photo[message.photo.length - 1].file_id;
  }
  // Скриншот, отправленный «как файл» — так его шлют, чтобы не терять качество
  if (message.document && String(message.document.mime_type || '').startsWith('image/')) {
    return message.document.file_id;
  }
  return null;
}

async function onMessage(message) {
  const chatId = message.chat.id;
  const userId = message.from && message.from.id;

  if (!isAllowed(userId)) {
    // В группе молчим полностью: если кто-то случайно кинет скриншот, бот не
    // должен отвечать всей группе. В личке отвечаем — так админ узнаёт свой ID.
    if (message.chat.type === 'private') {
      await tg.sendMessage(chatId, `Этот бот только для администраторов Шабашки.\nВаш ID: ${userId}`);
    }
    return;
  }

  const text = (message.text || message.caption || '').trim();

  if (text === '/start' || text === '/help') {
    await tg.sendMessage(
      chatId,
      [
        '👋 Присылай скриншот объявления из WhatsApp или пересылай сообщение из чата.',
        'Публикую сразу, ничего не переспрашивая: объявление уходит на сайт,',
        'в Telegram-канал и роликом в Instagram и Threads. Если объявлений на скриншоте',
        'несколько — опубликую каждое.',
        '',
        'Заказ и вакансия становятся карточкой на сайте. Всё остальное — продажа дома',
        'или машины, аренда, «делаем ремонт под ключ», поиск работы для себя —',
        'уходит на 📌 доску: там объявление живёт сутки, ролик и пост в канале',
        'при этом делаются точно так же.',
        '',
        'Чего не хватает — дописываю сам (город → Бишкек, категория → Другое)',
        'и пишу об этом в ответе. В ответ присылаю текст объявления целиком,',
        'как он ушёл на сайт, и кнопку 🗑 «Удалить с сайта» — прочитал, и если',
        'в разбор попало лишнее, сразу убрал.',
        '',
        'В соцсети объявление уходит не мгновенно, и это нарочно: в Threads —',
        `по одному, но не чаще раза в ${social.THREADS_INTERVAL_MIN} минут (иначе он ловит антиспам),`,
        'в Instagram — своим роликом на каждое, с названием по типу: «Вакансия дня»,',
        '«Заказ дня», «Объявление дня». Ждать компанию объявлению больше не нужно,',
        'ролик собирается сразу. Про каждое напишу отдельно, когда дойдёт очередь.',
        '',
        '/now — выпустить то, что почему-то ещё стоит в очереди, не дожидаясь своего',
        'хода. Работает и словом: напишите «выпусти», «выпускай» или «публикуй».',
        '',
        'Если ролик не ушёл в Instagram (у Meta часто рвётся соединение, а на бесплатном',
        'сервере сборка видео иногда не влезает в память), то же объявление уедет',
        'обычным постом с картинкой — тот же макет, та же подпись, просто без видео.',
        'Об этом напишу в отчёте. Если не прошла и картинка, пришлю сам ролик и кнопку',
        '🔁 «Попробовать опубликовать ещё раз» — нажал, и он поедет заново, без пересборки.',
        '',
        'Пачку скриншотов можно кинуть разом: поставлю в очередь и разберу по одному',
        '(бесплатный Groq за минуту успевает примерно полтора скриншота).',
        '',
        `/top — ролик-подборка с сайта: ${digestRepo.SIZE} случайных объявлений за ${digestRepo.DAYS} дня`,
        '(«Топ-5 вакансий»), в конце — сколько их всего ждёт на сайте. Спрошу, что брать:',
        'заказы, вакансии или объявления с доски. Пригодится в тихий день, когда новых',
        'скриншотов нет, а лента не должна простаивать.',
        '',
        '/stats — сколько опубликовано сегодня и сколько роликов ещё в работе',
      ].join('\n')
    );
    return;
  }

  if (text === '/stats') {
    await tg.sendMessage(chatId, await statsText());
    return;
  }

  // «Выпускай» словом — потому что команду эту дают на бегу, и вспоминать её
  // имя в такой момент не хочется. Короткие слова до этой проверки всё равно
  // ни во что не превращались: объявлением текст становится только с 15 знаков.
  if (text === '/now' || FLUSH_WORDS.has(text.toLowerCase())) {
    await onFlushCommand(chatId);
    return;
  }

  if (text === '/top') {
    await tg.sendMessage(
      chatId,
      [
        `🎬 Соберу ролик из ${digestRepo.SIZE} случайных объявлений с сайта за ${digestRepo.DAYS} дня`,
        'и в конце позову на сайт. Что берём?',
      ].join('\n'),
      digestMenu()
    );
    return;
  }

  const fileId = photoFileId(message);
  if (fileId) {
    const mediaType =
      message.document && message.document.mime_type ? message.document.mime_type : 'image/jpeg';

    const position = enqueue(chatId, async () => {
      const buffer = await tg.downloadFile(fileId);
      const parsed = await extract.fromImage(buffer, mediaType);
      await handleParsed(chatId, parsed, { source: 'whatsapp', rawText: text || null });
    });

    await tg.sendMessage(
      chatId,
      position === 1
        ? '🔍 Читаю скриншот…'
        : `📥 В очереди — ${position}-й, дойду ${waitText((position - 1) * extract.PACE_MS)}.`
    );
    return;
  }

  if (text.length > 15) {
    const position = enqueue(chatId, async () => {
      const parsed = await extract.fromText(text);
      await handleParsed(chatId, parsed, { source: 'telegram', rawText: text });
    });
    if (position > 1) {
      await tg.sendMessage(
        chatId,
        `📥 В очереди — ${position}-й, дойду ${waitText((position - 1) * extract.PACE_MS)}.`
      );
    }
    return;
  }

  await tg.sendMessage(chatId, 'Пришли скриншот объявления или перешли сообщение из чата.');
}

async function onCallback(query) {
  const userId = query.from.id;
  if (!isAllowed(userId)) {
    await tg.answerCallbackQuery(query.id, 'Нет доступа');
    return;
  }

  const [action, rawId] = String(query.data || '').split(':');
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  if (action === 'rt') {
    // Ответить Telegram надо в пару секунд, а площадка обрабатывает ролик минуту
    // и дольше — поэтому попытка уезжает своим ходом. Кнопку сразу убираем: два
    // нажатия подряд означали бы два поста об одном объявлении.
    await tg.answerCallbackQuery(query.id, 'Пробую ещё раз — напишу, чем кончилось');
    await tg
      .call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId })
      .catch(() => {}); // кнопки уже нет — не повод падать
    retrySocial(chatId, rawId).catch(async (err) => {
      console.error('Повтор публикации:', err);
      await tg.sendMessage(chatId, `⚠️ Повтор не вышел: ${tg.esc(err.message)}`).catch(() => {});
    });
    return;
  }

  if (action === 'dg') {
    // Выборка из базы, сборка пяти карточек и загрузка на площадку — это минуты,
    // а ответить Telegram надо в пару секунд. Кнопки убираем сразу: два нажатия
    // подряд означали бы два ролика и два места в суточной квоте.
    await tg.answerCallbackQuery(query.id, 'Собираю подборку');
    await tg
      .call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId })
      .catch(() => {});
    makeDigest(chatId, rawId).catch(async (err) => {
      console.error('Подборка:', err);
      await tg.sendMessage(chatId, `⚠️ Подборка не вышла: ${tg.esc(err.message)}`).catch(() => {});
    });
    return;
  }

  if (action === 'fl') {
    // Кнопки убираем сразу: второе нажатие выпустило бы второй ролик — уже
    // пустой, но место в суточной квоте Instagram он бы занял.
    await tg.answerCallbackQuery(query.id, 'Собираю ролик');
    await tg
      .call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId })
      .catch(() => {});
    flushQueue(chatId, rawId).catch(async (err) => {
      console.error('Досрочный выпуск:', err);
      await tg.sendMessage(chatId, `⚠️ Выпустить не вышло: ${tg.esc(err.message)}`).catch(() => {});
    });
    return;
  }

  const id = parseInt(rawId, 10);

  const row = Number.isInteger(id) ? await imports.get(id) : null;
  if (!row) {
    await tg.answerCallbackQuery(query.id, 'Объявление не найдено');
    return;
  }

  if (action === 'del') {
    try {
      await imports.remove(id);
      await tg.answerCallbackQuery(query.id, 'Удалено с сайта');
      await tg.editMessageText(
        chatId,
        messageId,
        `🗑 <b>${tg.esc(row.parsed.title || 'без названия')}</b>\nУдалено с сайта.\n\n⚠️ В Telegram-канале, Instagram и Threads пост остаётся — их надо убрать вручную.`
      );
    } catch (err) {
      await tg.answerCallbackQuery(query.id, err.message.slice(0, 190));
    }
  }
}

async function handleUpdate(update) {
  try {
    if (update.message) await onMessage(update.message);
    else if (update.callback_query) await onCallback(update.callback_query);
  } catch (err) {
    console.error('Telegram bot:', err);
    const chatId =
      (update.message && update.message.chat.id) ||
      (update.callback_query && update.callback_query.message.chat.id);
    if (chatId) {
      await tg
        .sendMessage(chatId, `⚠️ Ошибка: ${tg.esc(err.message)}`)
        .catch(() => {}); // сообщить не вышло — в логах ошибка уже есть
    }
  }
}

module.exports = {
  handleUpdate,
  isConfigured: () => tg.hasToken() && ADMIN_IDS.size > 0,
  // Тот же путь публикации, которым идут скриншоты из личных сообщений —
  // используется автоимпортом из чужого канала (см. sourceWatcher.js), чтобы
  // не заводить вторую копию логики очереди/дедупа/публикации/отчётов.
  ingestFromSource: handleParsed,
};

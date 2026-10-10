const { domainToUnicode } = require('url');

const tg = require('./api');
// Кто имеет право публиковать через бота. Список общий с уведомлениями о жалобах
// (см. notify.js): это те же люди и тот же чат.
const { ADMIN_IDS, isAllowed, notifyAdmins } = require('./notify');
const extract = require('./extract');
const { abroadWork } = require('../abroad');
const students = require('../students');
const imports = require('./imports');
const deferred = require('./deferred');
const queue = require('./queue');
const social = require('../social');
const dm = require('../dm');
const spam = require('../spam');
const digestRepo = require('../digestRepo');
const feedStats = require('./feedStats');
const blocklist = require('./blocklist');
const summary = require('./summary');
const rejected = require('./rejected');
const adGroups = require('./adGroups');
const menu = require('./menu');
const products = require('./products');
const adRaises = require('./adRaises');
const { num, plural, viewsWord, clamp, clock, whenText, agoText } = require('./format');
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

// Посты из чужих групп бот публикует молча: карточку, очередь площадок и
// отчёты по ним не присылает, а считает для сводки (см. summary.js). Из групп
// их выходит под сотню в день, и по пять сообщений на каждый топили в чате то,
// что требует решения: оплату рекламы, отказ площадки, вопрос из директа.
// Снять лишнее можно из /last. SOURCE_REPORTS=full возвращает отчёт по каждому.
const GROUP_REPORTS = String(process.env.SOURCE_REPORTS || 'summary').trim();
const isQuiet = (source) => source === 'channel' && GROUP_REPORTS !== 'full';

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
  const lines = [`${students.label(listingType, parsed)}: ${parsed.title || 'Без заголовка'}`, ''];

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
// такие случаи идут не обычным каскадом, а одним долгим ожиданием
// (LIMIT_RETRY_DELAY_MS в scheduleAutoRetry).
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

// Суточная норма площадки — не сбой, и пятиминутными повторами её не пройти:
// окно у Instagram скользящее, место освобождается ровно через сутки после той
// публикации, которая его заняла. Раньше на этом каскад останавливался совсем,
// и ролик ждал, пока админ вспомнит про кнопку, — а чаще всего не вспоминал, и
// объявление оставалось на сайте, но не в Instagram. Теперь бот обнуляет
// расписание и возвращается через десять часов: к этому времени первые за
// прошлые сутки публикации из окна уже выпали, а сам он ждать не заставляет.
const LIMIT_RETRY_DELAY_MS = 10 * 60 * 60 * 1000;
// Сколько раз так ждать. Два захода — это сутки с лишним; если и после них
// места нет, дело не в норме, а в том, что аккаунт занят чем-то ещё, и держать
// ролик в памяти дальше незачем — остаётся кнопка.
const LIMIT_RETRY_MAX = 2;

// Повтор удался — в счётчики сводки. Провал повтора не считаем: он уже
// посчитан с первой попытки, а девять неудачных заходов — это одна неудача.
function countRetried(result) {
  if (result.threads && result.threads.posted) feedStats.bump('th.ok');
  if (result.instagram && result.instagram.posted) feedStats.bump(result.instagram.asImage ? 'ig.image' : 'ig.reel');
}

// quiet — пост из группы: повторяем так же, но в чат об этом не пишем.
function scheduleAutoRetry(chatId, retryId, attempt = 0, waited = 0, quiet = false) {
  // Ожидание нормы идёт своим сроком и не тратит попытку каскада: вернувшись
  // через десять часов, бот начинает расписание заново, как с первой публикации.
  const delay = attempt === 0 && waited ? LIMIT_RETRY_DELAY_MS : AUTO_RETRY_DELAYS[attempt];
  setTimeout(async () => {
    let result;
    try {
      result = await social.retry(retryId);
    } catch (err) {
      console.error('Автопостинг (авто-повтор):', err);
      return;
    }
    if (!result) return; // ролик выветрился из памяти — дальше только вручную, из сообщения выше
    countRetried(result);

    const { sites, failed, lines } = socialReport(result);
    // reason — это причина, по которой до площадок вообще не дошло (ни одна не
    // настроена). Без этой строки провал выглядел бы как успех.
    if (result.reason) lines.push(`🎬 ${tg.esc(result.reason)}`);

    if (!failed.length && !result.reason) {
      if (sites.length && !quiet) {
        await tg
          .sendMessage(chatId, `${sites.map((n) => SITE_LABELS[n]).join(' и ')} — опубликовано (сам, с повторной попытки)`)
          .catch(() => {});
      }
      return;
    }

    if (hasHardLimit(result, failed)) {
      // Квота или антиспам-блокировка сама за минуты не пройдёт — дальнейшие
      // попытки каждые 5-60 минут только жгли бы её впустую. Каскад обнуляем и
      // возвращаемся к ролику через десять часов, когда окно сдвинется.
      if (waited < LIMIT_RETRY_MAX && result.retryId) {
        scheduleAutoRetry(chatId, result.retryId, 0, waited + 1, quiet);
        if (quiet) return;
        await tg
          .sendMessage(
            chatId,
            `⏳ Упёрлись в лимит площадки: ${lines.join('; ')}\nПопробую сам через 10 часов — присылать заново не нужно.`
          )
          .catch(() => {});
        return;
      }
      if (quiet) return;
      await tg
        .sendMessage(
          chatId,
          `⏳ Лимит площадки не отпустил и через ${waited * 10} часов: ${lines.join('; ')}\nДальше только кнопкой в сообщении с роликом.`
        )
        .catch(() => {});
      return;
    }

    if (attempt + 1 < AUTO_RETRY_DELAYS.length && result.retryId) {
      scheduleAutoRetry(chatId, result.retryId, attempt + 1, waited, quiet);
      return;
    }

    // Автопопытки кончились — дальше только руками по кнопке в исходном сообщении.
    if (quiet) return;
    await tg
      .sendMessage(chatId, `⚠️ Само не получилось за ${AUTO_RETRY_SPAN}: ${lines.join('; ')}`)
      .catch(() => {});
  }, delay);
}

// Ни одна площадка больше не отвечает сразу: в Threads объявление уходит по
// одному, но не залпом (его антиспам ловит частоту), а в Instagram — пачкой по
// три (квота считает посты, а не объявления). Поэтому здесь только расписка о
// приёме: что куда встало в очередь. Чем кончилось, скажут отдельные сообщения
// из social.onThreads и social.onReel ниже.
// importId едет в ctx до самых отчётов: пост в Threads и ролик уходят минутами
// позже, и связать их с объявлением можно только так. Без этого снятие
// объявления знало бы про один сайт (см. imports.setPosts).
// dmChatId — реклама оплачена в директе Threads (см. src/dm): когда пост выйдет,
// ссылку на него получит сам рекламодатель.
// quiet — пост из группы (см. isQuiet): на площадки уходит так же, но расписки
// о приёме в чат нет.
async function shareToSocial(
  chatId,
  parsed,
  listingType,
  siteLink,
  { priority = false, importId = null, dmChatId = null, quiet = false } = {}
) {
  try {
    const result = await social.shareListing(
      parsed,
      listingType,
      siteLink,
      { chatId, importId, ...(quiet ? { quiet: true } : {}), ...(dmChatId ? { dmChatId, dmLink: siteLink } : {}) },
      { priority }
    );
    if (quiet) return;
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
      // Ролик выходит по расписанию, а не сразу (см. RELEASE_INTERVAL_MS в
      // social/index.js), и молчание Instagram читалось бы как сбой. Поэтому
      // говорим и сколько объявлений ждёт вместе с этим, и когда ближайший
      // выпуск. У платной рекламы расписания нет — она уезжает сразу.
      lines.push(
        result.releaseInMin
          ? `🎬 «${tg.esc(result.collection)}»: в очереди ${result.waiting}, до ${social.BATCH_SIZE} в ролике, выпуск раз в ${result.releaseInMin} мин`
          : `🎬 «${tg.esc(result.collection)}» — собираю ролик`
      );
    }

    if (lines.length) await tg.sendMessage(chatId, lines.join('\n'));
  } catch (err) {
    if (quiet) {
      console.error('Соцсети (пост из группы):', err.message);
      return;
    }
    await tg.sendMessage(chatId, `⚠️ Соцсети: ${tg.esc(err.message)}`);
  }
}

// Отчёт по посту в Threads. Как и у ролика, приходит не в ответ на объявление,
// а когда до поста дошла очередь, — поэтому называем заголовок, иначе непонятно,
// за какое из объявлений оно отчитывается.
social.onThreads(async ({ title, ctx, posted, reason, hardLimit, retryId, id, text }) => {
  const chatId = ctx && ctx.chatId;
  feedStats.bump(posted ? 'th.ok' : 'th.fail');
  // Запоминаем до отчёта и независимо от него: чат мог отвалиться, а пост уже
  // висит, и снимать его потом всё равно придётся. Повтор рекламы (campaignId)
  // карточку на сайте не заменяет — снимать по ней надо первый пост.
  if (posted && ctx && ctx.importId && !ctx.campaignId) {
    await imports.setPosts(ctx.importId, { threadsPostId: id }).catch((err) =>
      console.error('[снятие] id поста Threads не записан:', err.message)
    );
  }

  // Реклама: пост заводит кампанию, за которой бот следит сутки и потом
  // отчитывается просмотрами (см. social/adTracker.js). Повтор кнопкой
  // «поднять» добавляется к той же кампании — просмотры складываются.
  let tracked = false;
  let campaignId = null;
  if (posted && ctx && (ctx.ad || ctx.campaignId)) {
    try {
      if (ctx.campaignId) {
        await social.adTracker.addPost(ctx.campaignId, id);
      } else {
        campaignId = await social.adTracker.track({
          chatId,
          importId: ctx.importId || null,
          title,
          threadsText: text,
          media: ctx.adMedia || null,
          card: ctx.card || null,
          postId: id,
        });
      }
      tracked = true;
    } catch (err) {
      console.error('[реклама] кампания не заведена:', err.message);
    }
  }

  // Реклама из директа: ссылку на пост — рекламодателю, туда же, где он платил.
  // Своим ходом: отчёт админу ждать её незачем.
  if (posted && ctx && ctx.dmChatId && !ctx.campaignId) {
    social
      .threadsPermalink(id)
      .catch(() => '')
      .then((link) => dm.onPosted(ctx.dmChatId, link || ctx.dmLink || '', campaignId))
      .catch((err) => console.error('[директ] ссылка на пост не ушла:', err.message));
  }

  if (!chatId) return;
  // Пост из группы: в чат не пишем, в сводке он уже посчитан. Не вышел —
  // повторяем так же, как обычный, только молча.
  if (ctx.quiet) {
    if (!posted && retryId) scheduleAutoRetry(chatId, retryId, 0, hardLimit ? 1 : 0, true);
    return;
  }
  const what = tg.esc(clamp(title || 'без заголовка', 80));

  if (posted) {
    const lines = [`🧵 Threads — опубликовано: ${what}`];
    if (tracked && !ctx.campaignId) {
      lines.push(
        `📊 Слежу за просмотрами: через ${Math.round(social.adTracker.WARN_AFTER_MS / 3600000)} ч скажу, если реклама отстаёт, через сутки пришлю отчёт.`
      );
    }
    if (tracked && ctx.campaignId) lines.push('📊 Просмотры этого поста сложатся с первым в отчёте.');
    await tg.sendMessage(chatId, lines.join('\n')).catch(() => {});
    return;
  }

  const lines = [`🧵 Threads: ${tg.esc(reason)}`, what];
  if (hardLimit) {
    lines.push('Упёрлись в антиспам Threads — вернусь через 10 часов, когда он отпустит. Можно и вручную.');
  }
  await tg
    .sendMessage(chatId, lines.join('\n'), retryId ? retryKeyboard(retryId) : undefined)
    .catch(() => {});
  // Как и у ролика: антиспам Threads держит часами, поэтому не бросаем, а
  // возвращаемся через десять часов.
  if (retryId) scheduleAutoRetry(chatId, retryId, 0, hardLimit ? 1 : 0);
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
        ? 'Упёрлись в лимит площадки — вернусь к ролику через 10 часов, когда окно сдвинется. Ролик выше, можно и вручную.'
        : result.buffer
        ? 'Бот попробует ещё раз сам. Ролик выше — можно опубликовать и вручную.'
        : 'Бот соберёт ролик заново и попробует опубликовать сам.'
    );
  }
  await tg
    .sendMessage(chatId, lines.join('\n'), result.retryId ? retryKeyboard(result.retryId) : undefined)
    .catch(() => {});
  // Упёрлись в суточную норму — расписание из пятиминутных попыток тут ни к
  // чему, но и бросать ролик нельзя: ждём десять часов и начинаем заново
  // (см. LIMIT_RETRY_DELAY_MS). waited = 1 — это и есть «первое ожидание».
  if (result.retryId) scheduleAutoRetry(chatId, result.retryId, 0, stuck ? 1 : 0);
}

// Куда слать отчёт, решаем по самим объявлениям, а не по настройкам: пачка
// собирается из того, что присылали в чат, и отчёт должен вернуться туда же.
social.onReel(async (result) => {
  // Ролик один на всю пачку, поэтому его id получают все объявления из неё:
  // сняли любое — ссылка ведёт в тот самый пост. Дайджест пропускаем: он
  // собран из уже опубликованного и к отдельному объявлению не привязан.
  if (result.instagram && result.instagram.posted && !result.digest) {
    for (const ctx of result.contexts || []) {
      if (!ctx || !ctx.importId) continue;
      await imports
        .setPosts(ctx.importId, { instagramMediaId: result.instagram.id })
        .catch((err) => console.error('[снятие] id ролика не записан:', err.message));
    }
  }

  if (result.instagram) {
    feedStats.bump(!result.instagram.posted ? 'ig.fail' : result.instagram.asImage ? 'ig.image' : 'ig.reel');
  }

  // Отчёт — только туда, где ролик ждут: посты из групп в нём идут молча.
  const contexts = (result.contexts || []).filter(Boolean);
  const chats = [...new Set(contexts.filter((c) => !c.quiet).map((c) => c.chatId).filter(Boolean))];
  for (const chatId of chats) await reportReel(chatId, result);
  // Ролик целиком из постов групп: отчёта нет, но не вышел — повторяем молча.
  if (!chats.length && result.retryId) {
    const quietChat = contexts.map((c) => c.chatId).find(Boolean);
    const stuck = Boolean(result.instagram && result.instagram.hardLimit);
    if (quietChat) scheduleAutoRetry(quietChat, result.retryId, 0, stuck ? 1 : 0, true);
  }
});

// Повтор по кнопке. Ролик уже собран и лежит в памяти процесса, заново кодировать
// его не надо — попытка занимает столько, сколько площадка обрабатывает видео.
async function retrySocial(chatId, retryId) {
  const result = await social.retry(retryId);
  if (!result) {
    await tg.sendMessage(
      chatId,
      '🎬 Ролик уже не в памяти (прошло больше двенадцати часов или сервер перезапускался) — выложите его вручную из сообщения выше.'
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

function topPrompt() {
  return [
    `🎬 Соберу ролик из ${digestRepo.SIZE} случайных объявлений с сайта за ${digestRepo.DAYS} дня`,
    'и в конце позову на сайт. Что берём?',
  ].join('\n');
}

function digestMenu() {
  return {
    reply_markup: {
      inline_keyboard: [DIGEST_TYPES.map(([type, label]) => ({ text: label, callback_data: `dg:${type}` }))],
    },
  };
}

// Адрес объявления на сайте — тот же, что и в карточке после публикации:
// у записки на доске своей страницы нет, ведём на доску с якорем.
function listingUrl(listingType, id) {
  if (!SITE_URL) return '';
  const path = listingType === 'board' ? `board#p${id}` : `${LISTING_PATHS[listingType]}/${id}`;
  return `${SITE_URL}/${path}`;
}

const listingLink = (listingType, id) => prettyLink(listingUrl(listingType, id));

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
          // Студенческая очередь — «vacancy_students» (см. queueKey в social).
          text: `${
            q.listingType.endsWith('_students')
              ? `🎓 ${TYPE_LABELS[q.listingType.split('_')[0]] || q.listingType}`
              : TYPE_LABELS[q.listingType] || q.listingType
          } ${q.count}`,
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
      `🎬 Собираю «${tg.esc(collection)}» — ${sent} ${tg.esc(digestRepo.word(listingType.split('_')[0], sent))}.`,
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
      '🎬 Ролика никто не ждёт — очередь пуста. Пришлите объявление текстом или соберите подборку с сайта: /top'
    );
    return;
  }

  if (byType.length === 1) {
    await flushQueue(chatId, byType[0].listingType);
    return;
  }

  await tg.sendMessage(chatId, '🎬 Ролика ждут объявления разных типов. Что выпускаем?', flushMenu(byType));
}

// /stats — та же сводка, что приходит по расписанию (см. summary.js), плюс
// технические строки: очереди, ролики в работе, квота Instagram. По ним видно,
// почему бот замолчал. Перед показом подтягиваем настоящее число публикаций у
// Instagram: свой счётчик обнуляется вместе с процессом.
async function statsText() {
  await social.syncQuota();
  const { text } = await summary.build({ tech: true, extra: pendingLines() });
  return text;
}

// Отложенные до лимита — только когда они есть: «отложено: 0» было бы шумом.
function pendingLines() {
  return pending.size ? [`⏳ Отложено до лимита: ${pending.size}`] : [];
}

// Настоящие суточные нормы площадок — числами от самой Meta, без наших догадок.
// Нужна эта команда не каждый день, а когда объявления перестали уходить и надо
// понять, упёрлись мы в потолок или сломалось что-то другое.
async function limitsText() {
  const { instagram: ig, threads: th } = await social.limits();

  const line = (icon, name, limit, note) => {
    if (!limit) return `${icon} ${name}: не настроен`;
    // Площадка не ответила — говорим об этом прямо. Ноль вместо числа выглядел
    // бы как «всё свободно», а это ровно противоположный вывод.
    if (limit.error) return `${icon} ${name}: не спросить — ${tg.esc(limit.error)}`;
    const free = Math.max(0, limit.total - limit.used);
    return `${icon} ${name}: ${limit.used} из ${limit.total} за сутки, свободно ${free} ${note}`;
  };

  return [
    line('📸', 'Instagram', ig, '(ролики, картинки и карусели — один общий счётчик)'),
    line('🧵', 'Threads', th, '(посты)'),
    '',
    // Свой потолок называем отдельно: по одной строке Meta «12 из 100» казалось
    // бы, что бот выложит сотню, а он остановится раньше (см. OWN_LIMIT в quota.js).
    `Сам бот выкладывает в Instagram не больше ${social.quota.hardLimit()} публикаций за сутки —`,
    `по ролику раз в ${social.RELEASE_INTERVAL_MIN} минут, до ${social.BATCH_SIZE} объявлений в каждом.`,
    `Последние ${social.quota.RESERVE} из них — только картинками: ролики до них не дотягиваются.`,
    'Платная реклама по /ad идёт сверх этого потолка — до нормы Meta выше.',
    '',
    'Сутки скользящие: место освобождается через 24 часа после каждой публикации,',
    'а не в полночь.',
  ].join('\n');
}

// Публикует объявление сразу, ничего не переспрашивая. Недостающие поля
// достраивает imports.applyDefaults — что именно дописали, показываем в ответе,
// чтобы подмена города или категории не прошла незамеченной.
// quiet — пост из группы: на сайт, в канал и на площадки уходит так же, но
// карточки в чат нет (см. isQuiet). Возвращает тип — для счётчиков сводки.
async function publishOne(chatId, id, parsed, priority = false, { quiet = false } = {}) {
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
  // Платное объявление и в канале, и в WhatsApp помечено так же, как в соцсетях
  // (см. adLine в social/video.js).
  const adMark = priority && social.adLine() ? `${social.adLine()}\n` : '';
  const body = `${adMark}${publicText(ready, result.type, '')}`;
  const publicMsg = `${adMark}${publicText(ready, result.type, shown)}`;
  const linkTag = siteLink ? `\n\n<a href="${siteLink}">${tg.esc(shown)}</a>` : '';

  // Канал — необязательный шаг: если пост туда не ушёл (бот не админ, канал
  // не задан), публикация на сайте всё равно должна засчитаться.
  let channelLine = '';
  if (CHANNEL_ID) {
    try {
      const inChannel = await tg.sendMessage(CHANNEL_ID, `${tg.esc(body)}${linkTag}`);
      await imports.setPosts(id, { channelMessageId: inChannel.message_id });
      channelLine = '📢 Выложено в Telegram-канал';
    } catch (err) {
      channelLine = `⚠️ В канал не ушло: ${tg.esc(err.message)}`;
    }
  }

  if (quiet) {
    shareToSocial(chatId, ready, result.type, shown, { priority, importId: id, quiet: true }).catch((err) =>
      console.error('Соцсети:', err)
    );
    return result.type;
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

  // «🚫 Спам» — снять и больше не брать из групп посты с этим номером (см.
  // blocklist.js). У рекламы такой кнопки нет: её прислали сами.
  const buttons = [{ text: '🗑 Удалить', callback_data: `del:${id}` }];
  if (!priority && ready.phone) buttons.push({ text: '🚫 Спам', callback_data: `spm:${id}` });
  const sent = await tg.sendMessage(chatId, lines.join('\n'), {
    reply_markup: { inline_keyboard: [buttons] },
  });
  await imports.setCard(id, chatId, sent.message_id);

  // Намеренно без await: ролик едет своим ходом, следующее объявление из пачки
  // не должно ждать кодирования и загрузки на площадки.
  shareToSocial(chatId, ready, result.type, shown, { priority, importId: id }).catch((err) =>
    console.error('Соцсети:', err)
  );
  return result.type;
}

// Что в сообщении есть, кроме текста. Нужно только рекламе: обычное объявление
// бот берёт со скриншота, а видео и гифку разобрать нечем в принципе.
// Размеры и длительность ролика нужны группам Telegram: юзер-сессия заливает
// файл заново, и без них ролик показался бы квадратиком (см. adGroups.js).
const videoOf = (v) => ({ kind: 'video', fileId: v.file_id, width: v.width, height: v.height, duration: v.duration });

function mediaOf(message) {
  const mime = message.document ? String(message.document.mime_type || '') : '';
  if (message.video) return videoOf(message.video);
  // Гифка в Telegram — это mp4 без звука, Instagram примет её так же, как ролик.
  if (message.animation) return videoOf(message.animation);
  if (mime.startsWith('video/')) return { kind: 'video', fileId: message.document.file_id };

  const photo = photoFileId(message);
  return photo ? { kind: 'image', fileId: photo } : null;
}

// Реклама «как есть»: сам контент модель не трогает — он уходит в канал и в
// Instagram в том виде, в каком его прислали. Этим путём выходит то, чего она не
// разберёт в принципе (видео, готовый макет), и то, что не влезло в её
// бесплатный лимит. Объявление всё равно должно выйти — за него заплачено.
//
// Карточка на сайте при этом собирается как обычно: тип, город, категорию и
// зарплату по возможности разбирает модель (см. adFields ниже), а чего не
// хватит — допишет applyDefaults.
// Поля рекламы, которую публикуем как есть. Тип у неё такой же, как у любого
// другого объявления: вакансию надо положить в вакансии, разовый заказ — в
// заказы, и только остальное — на доску. Раньше всё «как есть» уходило на
// доску, и оплаченная вакансия оказывалась в ленте коротких записок вместо
// своего раздела. Поэтому текст всё-таки показываем модели: сам контент она не
// трогает — ролик и макет уходят в том виде, в каком их прислали, — а по
// подписи говорит, что это и куда класть, заодно разбирая город, категорию и
// зарплату.
//
// classify = false там, где этот же текст модели уже показывали и она не
// справилась: второй заход кончится тем же отказом и только сожжёт суточный
// лимит.
//
// Когда модели нет, тип берём по словам. Раньше в этом случае всё падало на
// доску, и оплаченная вакансия на десяток поваров выходила короткой запиской
// «Требуются:» с ценой «договорная». Признаки нужны оба сразу — и «требуются»,
// и разговор про деньги или график: ошибиться типом у оплаченной рекламы так же
// некрасиво, как свалить её на доску. Не сошлось — доска, она принимает что
// угодно.
const VACANCY_HINTS = /требуе(тся|мся)|требуются|вакансия|ищем сотрудник|на постоянную работу|жумуш(чу)? керек|кызматкер керек/i;
const PAY_HINTS = /зарплат|оклад|оплата|график|смена|айлык|төлө/i;

function guessType(text) {
  return VACANCY_HINTS.test(text) && PAY_HINTS.test(text) ? 'vacancy' : 'board';
}

// Первая строка объявления часто оказывается шапкой — «Требуются:», «Срочно!».
// Одна такая на карточке и в ролике ничего не говорит, поэтому к короткой
// строке или строке с двоеточием на конце подклеиваем следующую, обрезав у неё
// значки и эмодзи в начале.
function headline(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return 'Реклама';
  const [first, second] = lines;
  if (!second || (first.length >= 12 && !/[:!]$/.test(first))) return first;
  return `${first.replace(/[:!]+$/, '')}: ${second.replace(/^[^\p{L}\p{N}]+/u, '')}`;
}

async function adFields(text, classify) {
  const byHand = {
    is_listing: true,
    listing_type: guessType(text),
    title: clamp(headline(text), 80),
    description: text,
    phone: extract.phoneFrom(text) || '',
    city: '',
    category: '',
    address: '',
    // Те же значения, что даёт разбор (см. normalize в extract.js): пустая
    // строка вместо суммы роняла публикацию вакансии ошибкой Postgres.
    budget: null,
    employment_type: 'gig',
    experience: 'no_experience',
    work_format: 'offline',
  };
  byHand.for_students = byHand.listing_type !== 'board' && students.forStudents(text);
  if (!classify) return byHand;

  try {
    const [parsed] = await extract.fromText(text, { ad: true });
    if (!parsed || !parsed.is_listing || parsed.listing_type === 'other') return byHand;
    // Описание всегда своё, из присланного текста. Модель возвращает список, и
    // в нём столько объявлений, сколько она разглядела: в одной рекламе кофейни
    // это и бариста, и техничка, и повара. Взяли бы описание у первого — из
    // оплаченной рекламы пропали бы остальные. Тип, город, категорию и зарплату
    // берём у первого: раздел и деньги у такой пачки общие.
    //
    // Заголовок и телефон — разобранные, если они есть: модель иногда
    // возвращает пустую строку, и подставлять её вместо живого текста нельзя.
    return {
      ...parsed,
      title: parsed.title || byHand.title,
      description: byHand.description,
      phone: parsed.phone || byHand.phone,
    };
  } catch (err) {
    console.error('[реклама] тип не определить:', err.message);
    return byHand;
  }
}

// dmChatId — реклама оплачена в директе Threads: ссылку на вышедший пост бот
// отправит рекламодателю туда же (см. onThreads и src/dm).
async function publishRawAd(chatId, message, text, media, priority, { classify = true, dmChatId = null } = {}) {
  const lines = [];
  let id = null;
  let ready = null;
  let siteLink = '';
  let listingType = 'board';

  if (text.length > 15) {
    const parsed = await adFields(text, classify);
    listingType = parsed.listing_type;
    id = await imports.create({ source: 'telegram', rawText: text, parsed, chatId, ad: true });
    if (id) {
      ready = (await imports.applyDefaults(parsed)).parsed;
      await imports.setParsed(id, ready);
      const published = await imports.publish(id);
      feedStats.bump('ad.ok');
      if (parsed.for_students) feedStats.bump('students');
      listingType = published.type;
      const path =
        published.type === 'board' ? `board#p${published.id}` : `${LISTING_PATHS[published.type]}/${published.id}`;
      siteLink = SITE_URL ? `${SITE_URL}/${path}` : '';
      lines.push(
        published.type === 'board'
          ? '✅ Повесил на доску — сутки, потом пропадёт само'
          : `✅ Опубликовал: ${published.type === 'vacancy' ? 'вакансия' : 'заказ'}`
      );
      // Номер тут не обязателен, в отличие от обычного объявления: в рекламе
      // контакт часто нарисован прямо на макете. Но сказать об этом надо —
      // кнопки WhatsApp на такой карточке не будет.
      if (!parsed.phone) lines.push('⚠️ Номера в тексте нет — кнопки WhatsApp на сайте не будет');
    } else {
      lines.push('♻️ На сайт не стал: такое же объявление приходило в этот час');
    }
  } else {
    lines.push('📄 На сайт не стал: без текста карточке нечего показать');
  }

  const shown = prettyLink(siteLink);
  const linkTag = siteLink ? `\n\n<a href="${siteLink}">${tg.esc(shown)}</a>` : '';

  if (CHANNEL_ID) {
    try {
      // Копией, а не своей отправкой: пересобирая контент, мы потеряли бы всё,
      // чего не умеем — кружок, альбом, гифку. Подпись в канале при этом своя,
      // со ссылкой на сайт. У Telegram она ограничена 1024 знаками.
      const adMark = priority && social.adLine() ? `${tg.esc(social.adLine())}\n\n` : '';
      const inChannel = media
        ? await tg.copyMessage(CHANNEL_ID, chatId, message.message_id, `${adMark}${tg.esc(clamp(text, 880))}${linkTag}`)
        : await tg.sendMessage(CHANNEL_ID, `${adMark}${tg.esc(text)}${linkTag}`);
      await imports.setPosts(id, { channelMessageId: inChannel.message_id });
      lines.push('📢 Выложено в Telegram-канал');
    } catch (err) {
      lines.push(`⚠️ В канал не ушло: ${tg.esc(err.message)}`);
    }
  }

  if (media) {
    try {
      const buffer = await tg.downloadFile(media.fileId);
      // Подписи для площадок собирает social: в Instagram — целиком, в Threads —
      // ужатой до его пятисот знаков. В ctx — всё, что нужно для отчёта по
      // просмотрам и для повтора: карточка на сайте и сам файл в Telegram.
      const result = social.shareMedia(
        { kind: media.kind, buffer, text, siteLink: shown, title: headline(text) },
        {
          chatId,
          importId: id,
          adMedia: priority ? { kind: media.kind, fileId: media.fileId } : null,
          ...(dmChatId ? { dmChatId, dmLink: shown } : {}),
        },
        { priority }
      );
      const caption = result.caption || text;
      for (const name of result.skipped) lines.push(`${SITE_LABELS[name]}: не настроен`);
      if (result.threadsQueued) {
        lines.push(media.kind === 'video' ? '🧵 Threads: отправляю ваш ролик' : '🧵 Threads: отправляю картинку');
      }
      if (result.instagramQueued) {
        lines.push(media.kind === 'video' ? '🎬 Instagram: отправляю ваш ролик' : '📸 Instagram: отправляю картинку');
        // Ответ площадки придёт через минуты — отдельным сообщением, как и у
        // обычного объявления.
        result.done
          .then((posted) => {
            if (!posted) return null;
            feedStats.bump(!posted.posted ? 'ig.fail' : media.kind === 'video' ? 'ig.reel' : 'ig.image');
            if (posted.posted) return tg.sendMessage(chatId, '📸 Instagram: реклама опубликована');
            // Файл у админа уже есть — он сам его и прислал, — а вот подписи
            // нет: в ней ссылка на карточку и хештеги, которые собирали мы.
            // Отдаём её отдельным сообщением, чтобы выложить руками можно было
            // копированием, а не переписыванием.
            return tg.sendMessage(
              chatId,
              [
                `📸 Instagram: ${tg.esc(posted.reason)}`,
                'Выложите ваш файл руками, подпись к нему:',
                '',
                tg.esc(caption),
              ].join('\n')
            );
          })
          .catch((err) => console.error('Реклама (Instagram):', err));
      }
    } catch (err) {
      // Телеграм не отдаёт боту файлы тяжелее 20 МБ — и это единственное, что
      // тут обычно ломается. На сайте и в канале реклама к этому моменту уже
      // есть, поэтому не падаем, а говорим, чего именно не хватило.
      lines.push(`⚠️ В соцсети не ушло: ${tg.esc(err.message)}`);
    }
  } else if (ready) {
    // Текстовая реклама без картинки идёт на площадки обычной дорогой: там ей
    // соберут ролик из макета, как и всякому другому объявлению.
    shareToSocial(chatId, ready, listingType, shown, { priority, importId: id, dmChatId }).catch((err) =>
      console.error('Соцсети:', err)
    );
  }

  // В группы Telegram, из которых бот берёт вакансии (см. adGroups.js), — тем
  // же текстом и файлом. Только то, что вышло на сайт: повтор в тот же час и
  // реклама без текста туда не идут.
  if (id) {
    const line = groupsLine(await queueGroups(id, chatId, text, media));
    if (line) lines.push(line);
    const raises = raisesLine(await planRaises(id, chatId));
    if (raises) lines.push(raises);
  }

  const sent = await tg.sendMessage(
    chatId,
    // «Как есть» — про сам контент: ролик и макет уходят такими, какими их
    // прислали. Тип при этом разобран, и в отчёте это должно быть видно —
    // иначе непонятно, почему реклама оказалась в вакансиях.
    [`📣 Реклама, контент выложен как есть.`, '', ...lines].join('\n'),
    id
      ? {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🗑 Удалить', callback_data: `del:${id}` }],
            ],
          },
        }
      : undefined
  );
  if (id) await imports.setCard(id, chatId, sent.message_id);
  return { id, siteLink: shown };
}

// Поставить рекламу в группы Telegram. Ошибка базы рекламу не роняет: на
// сайте и в канале она к этому моменту уже есть.
function queueGroups(importId, chatId, text, media = null) {
  return adGroups.enqueue({ importId, chatId, text, media }).catch((err) => ({ queued: 0, reason: err.message }));
}

// Поднятия рекламы по расписанию (см. adRaises.js). Ошибка базы рекламу не
// роняет — она уже вышла, поднятия можно запланировать из её карточки.
function planRaises(importId, chatId) {
  return adRaises.plan(importId, chatId).catch((err) => ({ count: 0, reason: err.message }));
}

function raisesLine(result) {
  if (result.reason) return `⚠️ Поднятия не запланированы: ${tg.esc(result.reason)}`;
  if (!result.count) return '';
  return `🔁 Поднятия: ${menu.raisePlanText(result.plan)}`;
}

// Строка отчёта про группы. silent — групп нет вовсе (автоимпорт не настроен):
// тогда и говорить не о чем.
function groupsLine(result) {
  if (!result || result.silent) return '';
  if (!result.queued) return `👥 В группы Telegram не ушло: ${tg.esc(result.reason)}`;
  const n = result.queued;
  return `👥 Группы Telegram: ${n} ${plural(n, ['группа', 'группы', 'групп'])}, по одной с паузами${
    n > 1 ? ` — последняя ≈ в ${clock(result.lastAt)}` : ''
  }. Итог — в «📣 Реклама»`;
}

// Отказ по загранице (см. abroad.js). Причину показываем со словом, на котором
// сработала проверка: так сразу видно, если она ошиблась.
function abroadText(reason) {
  return `🚫 Не публикую: ${tg.esc(reason)}.\nШабашка выкладывает только работу в Кыргызстане.`;
}

// Отказ по запрещённому (оформление на чужие документы, см. spam.js): такое не
// выкладываем и за деньги.
function bannedText(reason) {
  return `🚫 Не публикую: ${tg.esc(reason)}.\nТакое Шабашка не выкладывает и за деньги.`;
}

async function handleParsed(chatId, listings, { source, rawText, priority = false, ad = false }) {
  const quiet = isQuiet(source);
  const real = listings.filter((p) => p.is_listing && p.listing_type !== 'other');
  if (real.length === 0) {
    // Пост из группы: почему не вышел, уже посчитано в sourceWatcher.
    if (quiet) return 0;
    const abroad = listings.find((p) => p.abroad);
    const banned = listings.find((p) => p.forbidden);
    if (abroad || banned) {
      // Здесь молчать нельзя и по рекламе: публикации «как есть» за этим
      // отказом не будет (см. adJob в onMessage).
      await tg.sendMessage(chatId, abroad ? abroadText(abroad.note) : bannedText(banned.note));
    } else if (!ad) {
      // За отказом по рекламе тут же идёт публикация «как есть» — молчим, чтобы
      // не пугать админа отказом, за которым сразу следует успех.
      const note = listings[0] && listings[0].note;
      await tg.sendMessage(chatId, `🚫 Не похоже на объявление.${note ? `\n${tg.esc(note)}` : ''}`);
    }
    return 0;
  }

  // По самим карточкам не видно, сколько объявлений было в сообщении: одна
  // карточка — это и «объявление было одно», и «модель разобрала одно из пяти».
  // Строкой выше разница заметна сразу, без лазанья в логи.
  const skipped = listings.filter((p) => !real.includes(p));
  if (!quiet && (real.length > 1 || skipped.length)) {
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
  let firstId = null;
  for (const parsed of real) {
    const id = await imports.create({ source, rawText, parsed, chatId, ad: priority });
    if (id === null && quiet) {
      feedStats.bump('grp.dup');
      continue;
    }
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
      if (quiet) {
        feedStats.bump('grp.nophone');
        continue;
      }
      await tg.sendMessage(
        chatId,
        `🚫 «${tg.esc(parsed.title || 'без названия')}» без номера — не публикую, откликнуться было бы некуда.`
      );
      continue;
    }
    try {
      const type = await publishOne(chatId, id, parsed, priority, { quiet });
      if (!priority) feedStats.bump(source === 'channel' ? `grp.ok.${type}` : 'adm.ok');
      if (parsed.for_students) feedStats.bump('students');
      published += 1;
      if (!firstId) firstId = id;
    } catch (err) {
      // Одно неудачное объявление не должно ронять всю пачку из сообщения.
      if (quiet) {
        console.error(`[источник] «${parsed.title || 'без названия'}» не опубликовалось:`, err.message);
        feedStats.fail(err.message);
        continue;
      }
      await tg.sendMessage(
        chatId,
        `⚠️ «${tg.esc(parsed.title || 'без названия')}» не опубликовалось: ${tg.esc(err.message)}`
      );
    }
  }

  // Реклама в сводке — одна на сообщение, сколько бы вакансий модель в ней ни
  // разглядела: «кафе ищет бариста, повара и техничку» — это одна реклама.
  if (priority && published) feedStats.bump('ad.ok');
  // И в группы Telegram — тоже одним постом на сообщение, тем текстом, каким
  // его написал рекламодатель, а не нашими карточками по одной на вакансию.
  if (priority && firstId && rawText) {
    const line = [groupsLine(await queueGroups(firstId, chatId, rawText)), raisesLine(await planRaises(firstId, chatId))]
      .filter(Boolean)
      .join('\n');
    if (line) await tg.sendMessage(chatId, line).catch(() => {});
  }
  // Сколько объявлений вышло — по этому числу реклама решает, не пора ли
  // выкладывать как есть (см. adJob в onMessage).
  return published;
}

// «через 40 секунд» / «через 3 минуты» — прикидка, а не обещание: сколько
// придётся ждать на самом деле, знает только Groq по остатку лимита.
function waitText(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes >= 2) return `≈ ${minutes} мин`;
  return `≈ ${Math.max(1, Math.round(ms / 30000)) * 30} сек`;
}

// Платная реклама. Людям, которые пишут «разместите за деньги», платное
// объявление нельзя ставить в общий ряд: пачка объявлений разбирается минутами,
// а посты в Threads идут раз в десять минут — реклама уехала бы последней.
// Команда /ad помечает объявление, и дальше пометка едет с ним по всем трём
// очередям: разбор, Threads, ролик в Instagram.
//
// Промежутки между постами пометка не отменяет: они держат не порядок, а
// антиспам Threads и часовой лимит Instagram, и обгонять их нельзя никому.
//
// Вне очереди — ещё не «сразу». Дорожки разбора у Groq общие, и когда суточный
// лимит выбран, первым в очереди стоять бесполезно: реклама откладывается со
// всеми и ждёт часами. Для такого случая есть «/ad_fast» — та же реклама, но
// мимо модели совсем: тип берётся по словам, заголовок из первых строк
// (см. adFields), и объявление уходит на сайт, в канал и на площадки в ту же
// секунду. Платим за это разбором: города, категории и зарплаты в карточке не
// будет — только то, что видно в самом тексте.
const AD_TTL_MS = 30 * 60 * 1000;
// chatId → { until, fast }: до какого момента ждём рекламное объявление и надо
// ли выкладывать его без разбора. Срок нужен затем, чтобы забытая пометка не
// всплыла вечером на чужом объявлении.
const adWaiting = new Map();

// «/ad» отдельным сообщением помечает следующее объявление, «/ad текст» — само
// это сообщение. Возвращает и снимает пометку: одна команда — одна реклама.
function takeAd(chatId) {
  const mark = adWaiting.get(chatId);
  if (!mark) return null;
  adWaiting.delete(chatId);
  return mark.until > Date.now() ? mark : null;
}

// Отложенные объявления.
//
// Лимит модели — единственный отказ, который проходит сам собой: минутный
// отпускает через десяток секунд, суточный — через часы. Раньше в этот момент
// админ получал «⚠️ Ошибка: лимиты» и дальше помнил про объявление сам:
// караулил, когда лимит вернётся, и пересылал текст заново. Теперь объявление
// не теряется — бот запоминает его и возвращается к нему в названный Groq срок.
//
// Живёт в памяти процесса, как и очередь разбора: перезапуск Render отложенное
// теряет. Хранить в базе мешает то же, что и там: «доразбор через сутки после
// падения» всё равно никому не нужен — объявление к тому времени протухнет.
const PENDING_MAX_ATTEMPTS = 6;
// Минута сверху к названному сроку: лимит на той стороне считается скользящим
// окном, и возвращаться ровно в названную секунду — значит нарваться на тот же
// отказ и потратить попытку впустую.
const PENDING_MARGIN_MS = 60 * 1000;
// Даже когда до конца суточного лимита несколько часов, раз в час пробуем
// всё равно: считается он по скользящим суткам и часто отпускает раньше, чем
// обещал в ответе.
const PENDING_MAX_DELAY_MS = 60 * 60 * 1000;

// Только для отчёта в /stats: сколько объявлений сейчас лежит отложенными.
const pending = new Set();

// «в 14:05» для долгого ожидания и «через ≈ 2 мин» для короткого: до часа дня
// проще считать минутами, а вот «через 3 часа 40 минут» уже ни о чём не говорит.
function pendingText(delay) {
  if (delay < 10 * 60 * 1000) return `через ${waitText(delay)}`;
  const at = new Date(Date.now() + delay);
  return `в ${at.toLocaleTimeString('ru-RU', {
    timeZone: 'Asia/Bishkek',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

// Строку в базе убираем ровно один раз: и когда до объявления дошли руки, и
// когда его выложили кнопкой, не дожидаясь. Ошибку глотаем — объявление к
// этому моменту уже в работе, и падать из-за неубранной строки незачем.
function forget(entry) {
  if (!entry.rowId) return;
  const id = entry.rowId;
  entry.rowId = null;
  deferred.remove(id).catch((err) => console.error('[отложенное] строка не убрана:', err.message));
}

// row — строка из базы, если объявление вернулось после перезапуска: тогда
// заново её писать не надо, надо дожить до срока и убрать старую.
function park(chatId, job, retryAt, attempt, priority, ad, rowId = null) {
  const delay = Math.min(
    Math.max(retryAt - Date.now(), 0) + PENDING_MARGIN_MS,
    PENDING_MAX_DELAY_MS
  );

  const entry = { delay, done: false, rowId };
  pending.add(entry);

  // В базу — чтобы обещание «вернусь сам» пережило перезапуск Render
  // (см. deferred.js). Намеренно без await: ответ админу ждать записи не
  // должен, а таймер ниже всё равно сработает не раньше чем через минуту.
  if (!rowId && ad) {
    deferred
      .add({ chatId, messageId: ad.message && ad.message.message_id, text: ad.text, ad: true, attempt, retryAt })
      .then((id) => {
        // Кнопка могла сработать, пока шла запись, — тогда строку надо сразу
        // и убрать, иначе она воскреснет после перезапуска уже выложенной.
        entry.rowId = id;
        if (entry.done) forget(entry);
      })
      .catch((err) => console.error('[отложенное] не записал:', err.message));
  }

  entry.timer = setTimeout(() => {
    entry.done = true;
    pending.delete(entry);
    forget(entry);
    // Обратно в ту же очередь, а не мимо неё: к этому моменту админ мог
    // прислать новую пачку, и отложенное должно встать в общий ряд.
    enqueue(chatId, job, { attempt: attempt + 1, priority, ad });
    tg.sendMessage(chatId, '🔁 Лимит отпустил — возвращаюсь к отложенному объявлению.').catch(() => {});
  }, delay);

  return entry;
}

// Отложенную рекламу можно не ждать. Набирать «/ad_fast» и вставлять текст
// заново ради этого не нужно: объявление у нас уже есть, поэтому к сообщению об
// ожидании прикладывается кнопка, которая выкладывает его без разбора прямо
// сейчас. Ключ — счётчик, а не id объявления: на сайте его ещё нет.
let adNowSeq = 0;
const adNow = new Map();

// Кнопку, до которой не дошли руки, надо однажды забыть: бот вернулся к
// объявлению сам, сообщение уехало вверх по чату, а запись о нём вместе с
// текстом объявления осталась бы в памяти до перезапуска. Чистим при добавлении
// новой — отдельный таймер ради пары объектов в день заводить незачем.
function sweepAdNow() {
  for (const [key, ad] of adNow) {
    if (ad.parked.done) adNow.delete(key);
  }
}

function cancelPending(entry) {
  clearTimeout(entry.timer);
  entry.done = true;
  pending.delete(entry);
  forget(entry);
}


// Что бот делает с присланным текстом: разбирает, публикует, а рекламу, которую
// модель не осилила, выкладывает как есть. Отдельной функцией, а не замыканием
// внутри обработчика сообщения, потому что та же работа запускается ещё в двух
// местах: из отложенного, когда лимит отпустил, и после перезапуска, когда
// отложенное поднимают из базы (см. restoreDeferred). message нужен только
// рекламе — с него снимается копия в канал; у воскрешённого объявления от него
// остаётся один message_id, и этого достаточно.
// trusted — пост вернули из /spam кнопкой «Не спам» (см. rejected.js).
function parseJob(chatId, message, text, isAd, { trusted = false } = {}) {
  return async () => {
    let parsed = null;
    try {
      parsed = await extract.fromText(text, { ad: isAd, trusted });
    } catch (err) {
      if (!isAd || err.retryAt) throw err;
      await tg.sendMessage(chatId, `⚠️ Разобрать не вышло: ${tg.esc(err.message)}`);
    }
    const published = parsed
      ? await handleParsed(chatId, parsed, { source: 'telegram', rawText: text, priority: isAd, ad: isAd })
      : 0;
    // classify: false — этот же текст модель только что не осилила, второй
    // заход кончится тем же и лишь потратит суточный лимит. Работу за
    // границей «как есть» не выкладываем: это не сбой разбора, а отказ.
    const refused = parsed && parsed.some((p) => p.abroad || p.forbidden);
    if (isAd && !published && !refused) {
      await publishRawAd(chatId, message, text, null, true, { classify: false });
    }
  };
}

// Разбор ставим в очередь и отвечаем сразу: пачка из десятка объявлений
// разбирается несколько минут, и держать всё это время обработчик апдейта
// нельзя — при long polling на нём встали бы и все остальные сообщения.
function enqueue(chatId, job, { attempt = 0, priority = false, ad = null } = {}) {
  return queue.add(async () => {
    try {
      await job();
    } catch (err) {
      // retryAt ставит extract.js и только на 429 — значит, отказ временный и
      // ждать его есть смысл. Отозванный ключ или сломанная модель такой
      // пометки не получают и по-прежнему приходят ошибкой сразу.
      if (err.retryAt && attempt < PENDING_MAX_ATTEMPTS) {
        const parked = park(chatId, job, err.retryAt, attempt, priority, ad);
        const lines = [
          `⏳ Лимиты разбора выбраны. Объявление не потеряно — отложил и вернусь к нему сам ${pendingText(parked.delay)}. Присылать заново не нужно.`,
        ];
        let markup;
        if (ad) {
          const key = String((adNowSeq += 1));
          sweepAdNow();
          adNow.set(key, { ...ad, chatId, parked });
          lines.push('', 'Ждать не обязательно — кнопка выложит рекламу сразу, без разбора.');
          markup = {
            reply_markup: {
              inline_keyboard: [[{ text: '⚡ Выложить сразу, без разбора', callback_data: `an:${key}` }]],
            },
          };
        }
        await tg.sendMessage(chatId, lines.join('\n'), markup).catch(() => {});
        return;
      }

      console.error('Telegram queue:', err);

      // Реклама после всех попыток не пропадает. Разбор ей нужен — с ним в
      // карточке город, категория и зарплата, — но если лимиты не отпустили за
      // шесть заходов (это часы), ждать больше нечего: выкладываем как есть.
      // Заплатили за публикацию, а не за разбор.
      if (ad && err.retryAt) {
        await tg
          .sendMessage(chatId, '⏳ Лимиты разбора так и не отпустили — выкладываю рекламу как есть, без разбора.')
          .catch(() => {});
        await publishRawAd(chatId, ad.message, ad.text, null, true, { classify: false }).catch(async (rawErr) => {
          console.error('Реклама без разбора:', rawErr);
          await tg.sendMessage(chatId, `⚠️ Ошибка: ${tg.esc(rawErr.message)}`).catch(() => {});
        });
        return;
      }

      const detail = err.retryAt
        ? `лимиты разбора не отпустили за ${PENDING_MAX_ATTEMPTS} попыток, объявление придётся прислать заново (${err.message})`
        : err.message;
      await tg.sendMessage(chatId, `⚠️ Ошибка: ${tg.esc(detail)}`).catch(() => {});
    }
  }, { priority });
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

// Справка. Первой частью едут кнопки внизу экрана: по /start их и ждут.
async function sendHelp(chatId) {
  // Двумя сообщениями: одним справка не влезает в 4096 знаков Telegram. Делим
  // по смыслу — как публикую и какие есть команды, — а не где пришлось.
  const help = [
    [
      '☰ Меню — кнопки внизу экрана и /menu: реклама с просмотрами, сводка,',
      'посты из групп, группы для рекламы. Команды ниже работают и так.',
      '',
      '🔁 Поднятия рекламы — «☰ Меню»: платная реклама сама поднимается после',
      'выхода (по умолчанию 3 дня в 09:00 и 13:00) на сайте, в Threads, Instagram и',
      'группах. План рекламы — в «📣 Реклама» → «ℹ️» → «🔁 Поднятия».',
      '',
      '🛍 Мои продукты — /products или «☰ Меню»: свои товары (пригласительные,',
      'Scroll Book). У каждого несколько текстов и фото; бот выкладывает их в',
      'Threads и Instagram по кнопке и по расписанию, каждый раз со следующим текстом.',
      '',
      '👋 Пересылай сообщение из чата или кидай текст объявления.',
      'Публикую сразу, ничего не переспрашивая: объявление уходит на сайт,',
      'в Telegram-канал и роликом в Instagram и Threads. Если объявлений в сообщении',
      'несколько — опубликую каждое.',
      '',
      '🖼 Скриншоты я не читаю: картинка стоит вдвое дороже разбора и съедает',
      'суточную норму, а объявления в чатах всё равно пишут текстом. Пришли текст —',
      'разберу точнее, и за день выйдет вдвое больше объявлений.',
      '',
      'Заказ и вакансия становятся карточкой на сайте. Всё остальное — продажа дома',
      'или машины, аренда, «делаем ремонт под ключ», поиск работы для себя —',
      'уходит на 📌 доску: там объявление живёт сутки, ролик и пост в канале',
      'при этом делаются точно так же.',
      '',
      'Чего не хватает — дописываю сам (город → Бишкек, категория → Другое)',
      'и пишу об этом в ответе. В ответ присылаю текст объявления целиком,',
      'как он ушёл на сайт, и кнопку 🗑 «Удалить» — прочитал, и если',
      'в разбор попало лишнее, сразу убрал. Снимает она разом с сайта,',
      'из канала и из Threads; на ролик в Instagram даёт ссылку —',
      'его Meta через API удалять не даёт.',
      '',
      'В соцсети объявление уходит не мгновенно, и это нарочно: в Threads —',
      `по одному, но не чаще раза в ${social.THREADS_INTERVAL_MIN} минут (иначе он ловит антиспам),`,
      `в Instagram — роликом раз в ${social.RELEASE_INTERVAL_MIN} минут, по ${social.BATCH_SIZE} объявления в каждом,`,
      'с названием по типу: «Вакансии дня», «Заказы дня», «Объявления дня».',
      '',
      'Почему не сразу и не по одному: полсотни почти одинаковых роликов в сутки',
      'Instagram читает как рассылку и перестаёт показывать их тем, кто на нас',
      'не подписан. По расписанию выходит 8–10 постов в день — столько же, сколько',
      'у аккаунта, который ведут руками, — а объявлений в них едет втрое больше.',
      'Компанию объявление при этом не ждёт: подошло время — ролик уезжает хоть',
      'с одной карточкой. Про каждый напишу отдельно, когда дойдёт очередь.',
      'Не дожидаться расписания — /now.',
    ],
    [
      '/ad — платная реклама. Пришлите её следующим сообщением или сразу вместе',
      'с командой: «/ad Открылся салон…», а к картинке или видео — подписью.',
      'Такое объявление идёт вне очереди (разбор, Threads, ролик) и не',
      'отбраковывается отсевом — кроме запрещённого. Под неё отложена последняя',
      'модель разбора: посты из групп её не трогают, и когда они выберут',
      'суточную норму остальных, реклама всё равно разберётся.',
      '',
      'Рекламой можно прислать что угодно: готовый ролик, гифку, макет картинкой.',
      'Файл уйдёт в канал и в Instagram своим видом, без нашего макета, а подпись',
      'разберу как обычное объявление — вакансия попадёт в вакансии, разовая',
      'работа в заказы, остальное на доску. Не разберу подпись — повешу запиской',
      'на доску (заголовок — первая строка, телефон — первый номер из текста).',
      'Номер в тексте не обязателен, но без него на сайте не будет кнопки WhatsApp.',
      'Файл тяжелее 20 МБ Telegram боту не отдаёт — такой ролик сожмите заранее.',
      '',
      '/ad_fast — то же самое, но без разбора. Нужна, когда суточный лимит модели',
      'выбран: «вне очереди» тогда не помогает — дорожки общие, и реклама ждёт',
      'освобождения вместе со всеми. По этой команде объявление уходит на сайт,',
      'в канал и на площадки сразу. Тип определю по словам («требуются» плюс',
      'разговор про оплату — вакансия, иначе доска), заголовок соберу из первых',
      'строк. Города, категории и зарплаты в карточке не будет — их называет',
      'модель, а к ней мы не идём. Промежутки между постами остаются: они держат',
      `антиспам Threads (${social.THREADS_INTERVAL_MIN} минут) и часовой лимит Instagram, и снимать их нельзя —`,
      'за залп Threads блокирует на часы. Если суточная норма Instagram занята,',
      'ролик всё равно соберу и пришлю сюда файлом — выложите руками.',
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
      'Пачку объявлений можно кинуть разом: поставлю в очередь и разберу по одному',
      '(бесплатный Groq успевает около двух разборов в минуту на ключ).',
      '',
      'Если лимиты разбора выбраны, объявление не пропадает: откладываю его и',
      'возвращаюсь сам, когда лимит отпустит — присылать заново не нужно.',
      'Отложенное живёт в памяти бота, поэтому переживает ожидание, но не',
      'перезапуск сервера.',
      '',
      `/top — ролик-подборка с сайта: ${digestRepo.SIZE} случайных объявлений за ${digestRepo.DAYS} дня`,
      '(«Топ-5 вакансий»), в конце — сколько их всего ждёт на сайте. Спрошу, что брать:',
      'заказы, вакансии или объявления с доски. Пригодится в тихий день, когда новых',
      'объявлений нет, а лента не должна простаивать.',
      '',
      '/stats — сводка за сегодня: сколько вышло из групп и сколько отсеяно',
      '(и почему), реклама с просмотрами, площадки, модели разбора и очереди.',
      `Сама сводка приходит ${summary.HOURS.length ? `в ${summary.HOURS.map((h) => `${h}:00`).join(', ')}` : 'только по /stats'}.`,
      '',
      '/limits — суточные нормы Instagram и Threads числами от самой Meta:',
      'сколько уже потрачено и сколько осталось.',
    ],
    [
      '📣 Реклама в Threads',
      '',
      'Реклама уходит в Threads с картинкой: своей, если прислали, или',
      'карточкой объявления. Ролик в Instagram у неё свой, без попутчиков',
      'и без расписания.',
      '',
      `За каждой рекламой слежу. Через ${Math.round(social.adTracker.WARN_AFTER_MS / 3600000)} ч смотрю, как она идёт, и если к`,
      `суткам до ${social.adTracker.GOAL} просмотров может не дотянуть — пишу и даю кнопку`,
      '🔁 «Поднять в Threads»: реклама выйдет ещё раз, и просмотры сложатся.',
      `Поднимать можно до ${social.adTracker.MAX_BOOSTS} раз. Через сутки присылаю отчёт — просмотры,`,
      'лайки, ответы и выполнена ли гарантия. Его можно переслать рекламодателю.',
      '',
      '/ads — вся реклама, сначала новая. Нажмите на любую — просмотры и лайки',
      'в Threads, где она вышла, что с группами, отчёт для рекламодателя,',
      'кнопки «Поднять» и «Снять».',
      '/threads — статистика аккаунта за сутки и неделю, в среднем на пост:',
      'этими числами удобно отвечать тем, кто спрашивает про рекламу.',
      '',
      'Если под постом в Threads спрашивают про рекламу («сколько стоит',
      'разместить», «прайс»), пришлю этот ответ сюда со ссылкой — чтобы заявка',
      'не потерялась среди вопросов про вакансии.',
      '',
      '👥 Реклама в группах Telegram',
      '',
      'Каждая реклама уходит и в группы, из которых я беру вакансии, — тем же',
      'текстом и с той же картинкой или роликом. Пишет аккаунт, который читает',
      `группы: по одной группе, с паузой ≈${Math.round(adGroups.GAP_MS / 1000)} с, и в одну группу не чаще раза`,
      `в ${Math.round(adGroups.COOLDOWN_MS / 60000)} мин — иначе Telegram примет это за рассылку и ограничит аккаунт.`,
      'Группу, где писать нельзя (только админы, бан), пропускаю сутки и пишу почему.',
      '«Удалить» под рекламой снимает её и из групп.',
      '',
      '/groups — куда уходит реклама: выключить группу или всю рассылку.',
    ],
    [
      '🤖 Директ Threads',
      '',
      'На запросы на переписку в Threads отвечает ИИ — через расширение в вашем',
      'Chrome, где открыт threads.com. Он называет цену, после согласия даёт',
      'номер МБанка, читает скриншот чека и сам публикует рекламу — как /ad.',
      'Ссылку на пост и отчёт через сутки человек получает там же, в директе.',
      'Тем, кто принял нас за работодателя, объясняет, что мы только публикуем',
      'объявления.',
      '',
      'Каждый принятый чек присылаю сюда — сверьте с МБанком; если денег нет,',
      'рекламу снимает «Удалить» под её карточкой. Чек, который ИИ не принял',
      'сам, приходит с кнопками ✅ / ❌. Позовут человека — пришлю вопрос, и бот',
      'в том разговоре замолчит. Напишете в разговор сами — тоже замолчит.',
      '',
      '/dm — жив ли автоответчик и о чём разговоры, с кнопками «отвечу сам» и',
      '«вернуть боту».',
    ],
    [
      '📥 Посты из групп',
      '',
      'Их я публикую молча — без карточки и отчётов по каждому: из групп',
      'их выходит под сотню в день, и за ними терялось важное. Что вышло',
      'и что отсеяно, видно в сводке (/stats).',
      '',
      '/last (или «📥 Из групп») — всё опубликованное, сначала новое, по 10 на',
      'страницу; вкладки «Из групп», «Мои» и «Всё». Под списком кнопки: 🗑 — снять отовсюду,',
      `🚫 — снять и ${blocklist.DEFAULT_DAYS} дней не брать из групп посты с этим номером. Та же 🚫`,
      'есть под карточкой того, что прислали вы.',
      '',
      'Сетевой маркетинг («помощник администратора в офис, карьерный рост,',
      'всему научим») и оформление на чужие документы («доверенность',
      'на машину из Китая, деньги сразу») отсеиваю и без модели, по словам.',
      'Номер такого поста запоминаю сам. Одно и то же объявление, разосланное',
      'по десятку групп, разбираю один раз — норма модели уходит на новое.',
      '',
      '/spam — что отсеяно как мусор, с причиной. Ошибся — нажмите ✅:',
      'номер уйдёт из чёрного списка, а пост — на разбор заново.',
      '',
      '🎓 Для студентов. Если в объявлении прямо написано «можно студентам»,',
      '«для студентов» или «совмещать с учёбой», ставлю пометку сам: на сайте',
      'оно попадает в фильтр «Для студентов», в канале и Threads начинается',
      'с «🎓 Вакансия для студентов», а в Instagram выходит отдельным синим',
      'выпуском — первый экран «Вакансия для студентов», он же обложка.',
    ],
  ];
  for (const [i, part] of help.entries()) {
    await tg.sendMessage(chatId, part.join('\n'), i === 0 ? menu.KEYBOARD : undefined);
  }
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

  // Ждём тексты и фото для своего продукта (см. products.js) — присланное
  // идёт туда, а не на разбор как объявление.
  if (await products.onMessage(message, { isMenuKey: (t) => Boolean(menu.KEYS[t]) })) return;

  const raw = (message.text || message.caption || '').trim();

  // «/ad» можно послать и отдельным сообщением, и вместе с текстом объявления
  // («/ad Открылся салон…»), и подписью к скриншоту. Команду отрезаем — дальше
  // объявление идёт обычной дорогой, просто с пометкой.
  //
  // «/ad_fast» (или «/adfast») — та же реклама, но без разбора: когда лимиты
  // Groq выбраны, ждать освобождения незачем.
  const adPrefix = /^\/ad(_?fast)?(?:@\S+)?\b[\s:,-]*/i.exec(raw);
  const text = adPrefix ? raw.slice(adPrefix[0].length).trim() : raw;

  // Голая команда — значит, объявление придёт следующим сообщением.
  if (adPrefix && !text && !mediaOf(message)) {
    const fast = Boolean(adPrefix[1]);
    adWaiting.set(chatId, { until: Date.now() + AD_TTL_MS, fast });
    await tg.sendMessage(
      chatId,
      [
        '📣 Жду рекламное объявление — пришлите его следующим сообщением: текстом, картинкой или видео.',
        '',
        ...(fast
          ? [
              'Разбирать не буду — выложу сразу, как пришло. Тип определю по словам,',
              'заголовок соберу из первых строк. Города, категории и зарплаты',
              'в карточке не будет: их называет модель, а к ней мы не пойдём.',
            ]
          : [
              'Оно пойдёт без очереди: разберу первым, в Threads и Instagram отправлю',
              'первым и отсевом не отброшу. Промежутки между постами останутся прежними —',
              'они держат антиспам площадок, а не порядок.',
            ]),
        '',
        `Пометка ждёт ${Math.round(AD_TTL_MS / 60000)} минут и тратится на одно объявление.`,
      ].join('\n')
    );
    return;
  }

  if (text === '/start' || text === '/help') {
    await sendHelp(chatId);
    return;
  }

  // Меню (см. menu.js): кнопки внизу экрана присылают свой текст, «☰ Меню» и
  // /menu открывают остальное.
  const section = menu.KEYS[text];
  if (text === '/menu' || section) {
    await openSection(chatId, section || 'home');
    if (text === '/menu') await offerKeyboard(chatId);
    return;
  }

  if (text === '/groups') {
    await openSection(chatId, 'groups');
    return;
  }

  if (text === '/products') {
    await openSection(chatId, 'products');
    return;
  }

  if (text === '/stats') {
    await tg.sendMessage(chatId, await statsText());
    return;
  }

  if (text === '/limits') {
    await tg.sendMessage(chatId, await limitsText());
    return;
  }

  if (text === '/ads') {
    await openSection(chatId, 'ads');
    return;
  }

  if (text === '/threads') {
    await tg.sendMessage(chatId, await threadsStatsText());
    return;
  }

  if (text === '/spam') {
    const { text: report, extra } = spamText();
    await tg.sendMessage(chatId, report, extra);
    return;
  }

  if (text === '/last') {
    const { text: report, extra } = await publishedView();
    await tg.sendMessage(chatId, report, extra);
    return;
  }

  if (text === '/dm') {
    const { text: report, extra } = await dmStatusText();
    await tg.sendMessage(chatId, report, extra);
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
    await tg.sendMessage(chatId, topPrompt(), digestMenu());
    return;
  }

  // Пометку тратим здесь, а не в начале обработчика: между «/ad» и самим
  // объявлением админ может успеть спросить /stats, и съедать её на этом
  // вопросе было бы обидно.
  const media = mediaOf(message);
  const fileId = photoFileId(message);
  const marked = adPrefix ? null : (media || text.length > 15) && takeAd(chatId);
  const isAd = Boolean(adPrefix) || Boolean(marked);
  // «Без разбора» — свойство команды, а не сообщения: пометка от «/ad_fast»
  // доезжает до следующего сообщения такой же.
  const fast = adPrefix ? Boolean(adPrefix[1]) : Boolean(marked && marked.fast);

  // Работу за границей не выкладываем и за деньги (см. abroad.js). Проверяем до
  // всех веток рекламы: срочная, с роликом и с картинкой идут мимо модели, и
  // другого места для проверки у них нет. Что нарисовано на самом макете, бот
  // не читает — там проверить нечем.
  const abroad = isAd ? abroadWork(text) : '';
  if (abroad) {
    await tg.sendMessage(chatId, abroadText(`работа за границей («${abroad}»)`));
    return;
  }
  // Оформление на чужие документы за деньги — тоже до всех веток: срочная
  // реклама и реклама с файлом мимо модели, и проверить их больше негде.
  const banned = isAd ? spam.check(text, { ad: true }) : null;
  if (banned) {
    await tg.sendMessage(chatId, bannedText(spam.describe(banned)));
    return;
  }

  // Видео и гифку модель не читает вовсе — такая реклама идёт как есть и мимо
  // очереди разбора: Groq в ней не участвует, и занимать им дорожку незачем.
  if (isAd && media && media.kind === 'video') {
    await tg.sendMessage(
      chatId,
      fast
        ? '📣 Срочная реклама с готовым роликом — выкладываю сразу, подпись не разбираю.'
        : '📣 Реклама с готовым роликом — выкладываю как есть.'
    );
    publishRawAd(chatId, message, text, media, true, { classify: !fast }).catch((err) => {
      console.error('Реклама:', err);
      tg.sendMessage(chatId, `⚠️ Ошибка: ${tg.esc(err.message)}`).catch(() => {});
    });
    return;
  }

  // Картинку модель больше не читает (см. шапку extract.js): объявления в этих
  // чатах пишут текстом, а скриншот стоил вдвое дороже разбора и съедал
  // суточную норму токенов. Реклама — исключение: её контент публикуется как
  // есть, а тип и поля собираются по подписи.
  if (fileId) {
    if (isAd) {
      await tg.sendMessage(
        chatId,
        fast
          ? '📣 Срочная реклама картинкой — выкладываю сразу, подпись не разбираю.'
          : '📣 Реклама картинкой — выкладываю как есть, разберу подпись.'
      );
      publishRawAd(chatId, message, text, media, true, { classify: !fast }).catch((err) => {
        console.error('Реклама:', err);
        tg.sendMessage(chatId, `⚠️ Ошибка: ${tg.esc(err.message)}`).catch(() => {});
      });
      return;
    }

    // Подпись под картинкой чаще всего и есть само объявление — тогда разбирать
    // есть что и без самой картинки.
    if (text.length > 15 && extract.hasPhone(text)) {
      await tg.sendMessage(chatId, '🖼 Картинку не читаю — разбираю подпись к ней.');
    } else {
      await tg.sendMessage(
        chatId,
        [
          '🖼 Скриншоты я больше не читаю — только текст.',
          '',
          'Перешлите само сообщение из чата или скопируйте текст объявления сюда:',
          'так разбор точнее и дешевле, и объявлений за день выходит больше.',
          'Если это платная реклама — пришлите её с командой /ad, тогда картинка',
          'уйдёт в канал и в Instagram как есть.',
        ].join('\n')
      );
      return;
    }
  }

  if (text.length > 15) {
    // Срочная реклама к модели не идёт вовсе — ни в очередь разбора, ни в
    // отложенные. Ждать в ней нечего: дорожки Groq общие, и когда суточный
    // лимит выбран, место в начале очереди ничего не решает — объявление
    // простоит те же часы. Всё остальное (сайт, канал, Threads, ролик) идёт
    // обычной дорогой и вне очереди, как у «/ad».
    if (fast) {
      await tg.sendMessage(chatId, '📣 Срочная реклама — выкладываю сразу, без разбора.');
      publishRawAd(chatId, message, text, null, true, { classify: false }).catch((err) => {
        console.error('Реклама:', err);
        tg.sendMessage(chatId, `⚠️ Ошибка: ${tg.esc(err.message)}`).catch(() => {});
      });
      return;
    }

    const position = enqueue(chatId, parseJob(chatId, message, text, isAd), {
      priority: isAd,
      ad: isAd ? { message, text } : null,
    });
    if (isAd) {
      await tg.sendMessage(chatId, '📣 Реклама — разбираю вне очереди.');
    } else if (position > 1) {
      await tg.sendMessage(
        chatId,
        `📥 В очереди — ${position}-й, дойду ${waitText((position - 1) * extract.PACE_MS)}.`
      );
    }
    return;
  }

  await tg.sendMessage(chatId, 'Пришли текст объявления или перешли сообщение из чата.');
}

async function onCallback(query) {
  const userId = query.from.id;
  if (!isAllowed(userId)) {
    await tg.answerCallbackQuery(query.id, 'Нет доступа');
    return;
  }

  const [action, rawId, arg2, arg3] = String(query.data || '').split(':');
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  // «☰ Меню → 🔁 Поднятия рекламы»: rawId — что меняем, arg2 — значение.
  if (action === 'rs') {
    if (rawId === 'noop') {
      await tg.answerCallbackQuery(query.id, 'Выберите число дней в строке ниже');
      return;
    }
    if (rawId === 'd') await adRaises.setDays(arg2);
    else if (rawId === 't') await adRaises.setTimes(arg2);
    else if (rawId === 'p') await adRaises.toggle(arg2);
    await tg.answerCallbackQuery(query.id, 'Сохранил — для новой рекламы');
    await show(chatId, await raiseSettingsView(), messageId);
    return;
  }

  // Поднятия одной рекламы: rawId — v (показать), s (остановить), e (ещё день),
  // r (заново по настройкам); arg2 — реклама, arg3 — страница списка.
  if (action === 'rz') {
    const importId = Number(arg2);
    const done = {
      v: async () => '',
      s: async () => `Остановил: ${await adRaises.cancel(importId)}`,
      e: async () => `Добавил: ${await adRaises.extend(importId, chatId)}`,
      r: async () => {
        const result = await adRaises.restart(importId, chatId);
        return result.count ? `Запланировал: ${result.count}` : 'Поднятия выключены в настройках';
      },
    }[rawId];
    if (!done) {
      await tg.answerCallbackQuery(query.id);
      return;
    }
    await tg.answerCallbackQuery(query.id, await done());
    await show(chatId, await raisesView(importId, arg3), messageId);
    return;
  }

  // «🛍 Мои продукты» (см. products.js).
  if (action === 'pr') {
    await products.onCallback(query, [rawId, arg2, arg3], { show });
    return;
  }

  // Меню (см. menu.js): разделы открываются в том же сообщении.
  if (action === 'm') {
    await tg.answerCallbackQuery(query.id);
    await openSection(chatId, rawId, messageId);
    return;
  }

  // «📥 Из групп»: rawId — вкладка, arg2 — страница.
  if (action === 'lp') {
    await tg.answerCallbackQuery(query.id);
    await show(chatId, await publishedView(rawId, arg2), messageId);
    return;
  }

  // Список рекламы, страница rawId.
  if (action === 'al') {
    await tg.answerCallbackQuery(query.id);
    await show(chatId, await adsListView(rawId), messageId);
    return;
  }

  // «ℹ️» по рекламе rawId; arg2 — страница списка, куда вернуться; f — спросить
  // Threads заново, не дожидаясь четверти часа.
  if (action === 'ai') {
    const force = arg3 === 'f';
    await tg.answerCallbackQuery(query.id, force ? 'Спрашиваю свежие числа' : '');
    await show(chatId, await adInfoView(rawId, arg2, { force }), messageId);
    return;
  }

  // «Поднять» из карточки рекламы: rawId — кампания, arg2 — реклама, arg3 —
  // страница. Кнопку убираем сразу: второе нажатие подняло бы рекламу дважды.
  if (action === 'ib') {
    await tg.answerCallbackQuery(query.id, 'Поднимаю рекламу в Threads');
    await show(chatId, await adInfoView(arg2, arg3, { noBoost: true }), messageId);
    boostAd(chatId, rawId).catch(async (err) => {
      console.error('Повтор рекламы:', err);
      await tg.sendMessage(chatId, `⚠️ Поднять не вышло: ${tg.esc(err.message)}`).catch(() => {});
    });
    return;
  }

  // «🗑 Снять» из карточки рекламы — сначала вопрос (см. confirmRemoveView).
  if (action === 'ax') {
    const ad = await imports.get(Number(rawId));
    if (!ad || ad.status !== 'published') {
      await tg.answerCallbackQuery(query.id, 'Уже снято');
      return;
    }
    await tg.answerCallbackQuery(query.id);
    await show(chatId, menu.confirmRemoveView(ad, Number(arg2) || 0), messageId);
    return;
  }

  // Группы для рекламы: вся рассылка (ge) и одна группа (gt).
  if (action === 'ge') {
    await adGroups.setEnabled(rawId === '1');
    await tg.answerCallbackQuery(query.id, rawId === '1' ? 'Рассылка в группы включена' : 'Рассылка в группы выключена');
    await show(chatId, menu.groupsView(await adGroups.overview()), messageId);
    return;
  }

  if (action === 'gt') {
    const result = await adGroups.toggle(rawId);
    await tg.answerCallbackQuery(
      query.id,
      !result ? 'Этой группы уже нет в настройках' : result.on ? 'Группа включена' : 'Группа выключена — реклама в неё не пойдёт'
    );
    await show(chatId, menu.groupsView(await adGroups.overview()), messageId);
    return;
  }

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

  if (action === 'an') {
    const ad = adNow.get(rawId);
    // Кнопка живёт дольше самого ожидания: бот мог вернуться к объявлению сам,
    // пока сообщение висело в чате. Тогда публиковать второй раз нельзя.
    adNow.delete(rawId);
    if (!ad || ad.parked.done) {
      await tg.answerCallbackQuery(query.id, 'Бот уже вернулся к этому объявлению');
      return;
    }
    cancelPending(ad.parked);
    await tg.answerCallbackQuery(query.id, 'Выкладываю без разбора');
    await tg
      .call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId })
      .catch(() => {});
    publishRawAd(ad.chatId, ad.message, ad.text, null, true, { classify: false }).catch(async (err) => {
      console.error('Реклама без разбора:', err);
      await tg.sendMessage(chatId, `⚠️ Ошибка: ${tg.esc(err.message)}`).catch(() => {});
    });
    return;
  }

  if (action === 'ab') {
    // Кнопку убираем сразу: второе нажатие подняло бы рекламу второй раз.
    await tg.answerCallbackQuery(query.id, 'Поднимаю рекламу в Threads');
    await tg
      .call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId })
      .catch(() => {});
    boostAd(chatId, rawId).catch(async (err) => {
      console.error('Повтор рекламы:', err);
      await tg.sendMessage(chatId, `⚠️ Поднять не вышло: ${tg.esc(err.message)}`).catch(() => {});
    });
    return;
  }

  if (action === 'ar') {
    await tg.answerCallbackQuery(query.id, 'Собираю отчёт');
    (async () => {
      const campaign = await social.adTracker.get(Number(rawId));
      if (!campaign) {
        await tg.sendMessage(chatId, '📊 Этой рекламы уже нет в базе.');
        return;
      }
      let posts;
      let totals;
      try {
        ({ posts, totals } = await social.adTracker.refresh(campaign, { force: true }));
      } catch (err) {
        posts = await social.adTracker.postsOf(campaign.id);
        totals = social.adTracker.totalsOf(posts);
      }
      const final = social.adTracker.ageOf(campaign) >= social.adTracker.REPORT_AFTER_MS;
      await tg.sendMessage(chatId, adReportText(campaign, totals, posts, { final }));
    })().catch(async (err) => {
      console.error('Отчёт по рекламе:', err);
      await tg.sendMessage(chatId, `⚠️ Отчёт не собрать: ${tg.esc(err.message)}`).catch(() => {});
    });
    return;
  }

  // Директ Threads: решение по чеку и кто ведёт разговор (см. onDmEvent).
  if (action === 'dmok' || action === 'dmno') {
    // Кнопки убираем сразу: второе нажатие опубликовало бы рекламу дважды.
    await tg.answerCallbackQuery(query.id, action === 'dmok' ? 'Публикую' : 'Скажу, что оплаты нет');
    await tg.call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId }).catch(() => {});
    const verdict = await (action === 'dmok' ? dm.approve(Number(rawId)) : dm.reject(Number(rawId)));
    await tg.sendMessage(chatId, `🧾 Чек: ${tg.esc(verdict)}.`);
    return;
  }

  if (action === 'dmp' || action === 'dmr') {
    const ok = await (action === 'dmp' ? dm.pause(Number(rawId), 24) : dm.resume(Number(rawId)));
    await tg.answerCallbackQuery(
      query.id,
      !ok ? 'Разговор не найден' : action === 'dmp' ? 'Бот молчит в этом разговоре сутки' : 'Разговор снова ведёт бот'
    );
    return;
  }

  // «✅ Не спам» в /spam: номер — из чёрного списка, пост — на разбор заново,
  // уже как присланный админом (с карточкой и кнопкой «Удалить»).
  if (action === 'ns') {
    const entry = rejected.take(rawId);
    if (!entry) {
      await tg.answerCallbackQuery(query.id, 'Этого поста уже нет в списке');
      return;
    }
    await tg.answerCallbackQuery(query.id, 'Разбираю заново');
    const freed = await blocklist.remove(entry.phones).catch((err) => {
      console.error('[чёрный список] не снять:', err.message);
      return 0;
    });
    enqueue(chatId, parseJob(chatId, { message_id: messageId }, entry.text, false, { trusted: true }));
    await tg.sendMessage(
      chatId,
      [
        `✅ Разбираю заново: «${tg.esc(clamp(entry.text.replace(/\s+/g, ' '), 80))}»`,
        ...(freed ? [`Номер ${tg.esc(entry.phones.join(', '))} убрал из чёрного списка.`] : []),
        'Проверку на сетевой маркетинг для него пропускаю. Если и модель скажет «не объявление» — выложите его через /ad_fast.',
      ].join('\n')
    );
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

  // del и spm — кнопки под карточкой: отчёт о снятии встаёт на место карточки.
  // ldel и lspm — те же кнопки в списке «📥 Из групп» (/last): список трогать нельзя, по нему
  // снимают дальше, поэтому отчёт приходит отдельным сообщением.
  // spm и lspm заодно запоминают номер: посты с ним из групп больше не берём.
  if (['del', 'spm', 'ldel', 'lspm'].includes(action)) {
    if (row.status !== 'published') {
      await tg.answerCallbackQuery(query.id, 'Уже снято');
      return;
    }
    const asSpam = action === 'spm' || action === 'lspm';
    try {
      await imports.remove(id);
      await tg.answerCallbackQuery(query.id, asSpam ? 'Снимаю и запоминаю номер' : 'Снимаю объявление');
      const lines = [`🗑 <b>${tg.esc(row.parsed.title || 'без названия')}</b>`, ...(await unpublishLines(row))];
      if (asSpam && row.parsed.phone) {
        await blocklist.add([row.parsed.phone], `админ отметил спамом: ${String(row.parsed.title || '').slice(0, 120)}`);
        lines.push(
          `🚫 Номер ${tg.esc(row.parsed.phone)} — в чёрном списке на ${blocklist.DEFAULT_DAYS} дней: посты с ним из групп больше не беру.`
        );
      }
      if (action === 'del' || action === 'spm') await tg.editMessageText(chatId, messageId, lines.join('\n'));
      else await tg.sendMessage(chatId, lines.join('\n'));
    } catch (err) {
      await tg.answerCallbackQuery(query.id, err.message.slice(0, 190));
    }
  }
}

// /spam — что из групп отсеяно как мусор (см. rejected.js). Фильтр по словам
// и модель иногда ошибаются, а посты из групп бот публикует молча — увидеть
// ошибку можно только здесь.
const SPAM_LIMIT = 10;

function spamText() {
  const items = rejected.list(SPAM_LIMIT);
  if (!items.length) {
    return { text: '🧹 С последнего перезапуска из групп ничего не отсеяно как сетевое или запрещённое.' };
  }
  const lines = ['🧹 Отсеяно из групп как мусор:'];
  const buttons = [];
  for (const [i, item] of items.entries()) {
    lines.push(
      `${i + 1}. «${tg.esc(clamp(item.text.replace(/\s+/g, ' '), 110))}»`,
      `   — ${tg.esc(clamp(item.reason, 120))} · ${agoText(Date.now() - item.at)}`
    );
    buttons.push({ text: `✅ ${i + 1}`, callback_data: `ns:${item.id}` });
  }
  lines.push('', '✅ — это не спам: убрать номер из чёрного списка и разобрать пост заново.');
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(buttons.slice(i, i + 5));
  return { text: lines.join('\n'), extra: { reply_markup: { inline_keyboard: rows } } };
}

// «📥 Из групп» и /last — всё опубликованное, по десять на страницу, сначала
// новое. Посты из групп бот публикует молча, без карточки на каждое (см.
// isQuiet), и снять лишнее можно только отсюда. from — вкладка: groups (из
// групп), mine (присланное вручную) или all.
async function publishedView(from = 'groups', page = 0) {
  const tab = menu.PUBLISHED_TABS[from] ? from : 'groups';
  const total = await imports.countPublished(tab);
  const pages = Math.max(1, Math.ceil(total / menu.PUBLISHED_PAGE));
  const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const rows = await imports.listPublished({
    from: tab,
    limit: menu.PUBLISHED_PAGE,
    offset: current * menu.PUBLISHED_PAGE,
  });
  return menu.publishedView({
    rows: rows.map((row) => ({
      ...row,
      type: row.vacancy_id ? 'vacancy' : row.order_id ? 'order' : row.board_post_id ? 'board' : null,
      url: row.live ? adSiteUrl(row) : '',
    })),
    from: tab,
    page: current,
    pages,
    total,
    blockDays: blocklist.DEFAULT_DAYS,
  });
}

// Куда объявление ушло, оттуда его и снимаем. Автор пишет «нашли людей» — и
// снятая с сайта карточка ничего не меняет, пока пост в канале и в Threads
// по-прежнему приводит к нему звонящих.
//
// Пост в канале удаляет сам бот: он его и публиковал, а Telegram разрешает боту
// убирать свои сообщения там, где он админ. Threads снимает social.unpublish.
// Ролик в Instagram остаётся — на него даём прямую ссылку (почему именно так,
// см. unpublish).
async function unpublishLines(row) {
  const lines = ['Снято с сайта.'];

  if (row.channel_message_id && CHANNEL_ID) {
    try {
      await tg.call('deleteMessage', { chat_id: CHANNEL_ID, message_id: row.channel_message_id });
      lines.push('📢 Пост в Telegram-канале удалён.');
    } catch (err) {
      // Телеграм не даёт боту удалять свои сообщения старше 48 часов — а
      // объявления снимают и через неделю. Тогда только руками.
      lines.push(`⚠️ Пост в канале не удалить (${tg.esc(err.message)}) — уберите вручную.`);
    }
  }

  const away = await social.unpublish({
    threadsPostId: row.threads_post_id,
    instagramMediaId: row.instagram_media_id,
  });

  if (away.threads) {
    lines.push(
      away.threads.removed
        ? '🧵 Пост в Threads удалён.'
        : `⚠️ Threads не отдал пост (${tg.esc(away.threads.reason)}) — уберите вручную.`
    );
  }

  if (away.instagram) {
    // Ссылка кликабельная — в этом и смысл: искать ролик в ленте руками дольше,
    // чем удалить его.
    lines.push(
      away.instagram.link
        ? `📸 Instagram: <a href="${away.instagram.link}">откройте пост</a> и удалите — через API Meta нам этого не даёт.`
        : '📸 Instagram: пост остался, удалите его в приложении — через API Meta нам этого не даёт.'
    );
  }

  // Поднятия рекламы: ждущие отменяем, а их посты в Threads (и повторы
  // кнопкой) удаляем вслед за первым — иначе снятая реклама висела бы в ленте
  // ещё шестью постами.
  if (row.is_ad) {
    const cancelled = await adRaises.cancel(row.id).catch(() => 0);
    if (cancelled) lines.push(`🔁 Поднятия отменены: ${cancelled}.`);
    const campaign = await social.adTracker.byImport(row.id).catch(() => null);
    const repeats = campaign
      ? (await social.adTracker.postsOf(campaign.id).catch(() => [])).filter(
          (p) => String(p.threads_post_id) !== String(row.threads_post_id)
        )
      : [];
    let removed = 0;
    for (const post of repeats) {
      const away = await social.unpublish({ threadsPostId: post.threads_post_id });
      if (away.threads && away.threads.removed) removed += 1;
    }
    if (repeats.length) {
      lines.push(
        removed === repeats.length
          ? `🧵 Повторы в Threads удалены: ${removed}.`
          : `⚠️ Повторы в Threads удалены не все: ${removed} из ${repeats.length} — остальные уберите вручную.`
      );
    }
  }

  // Реклама в группах Telegram: ждущие посты отменяем, вышедшие удаляем.
  if (row.is_ad) {
    const groups = await adGroups
      .unpublish(row.id)
      .catch((err) => ({ cancelled: 0, deleted: 0, failed: [{ title: 'группы', reason: err.message }] }));
    if (groups.deleted) lines.push(`👥 Из групп Telegram удалено: ${groups.deleted}.`);
    if (groups.cancelled) lines.push(`👥 В группы больше не уйдёт: отменил ${groups.cancelled}.`);
    for (const f of groups.failed) {
      const name = f.link ? `<a href="${f.link}">${tg.esc(f.title)}</a>` : tg.esc(f.title);
      lines.push(`⚠️ ${name}: не удалить (${tg.esc(f.reason)}) — уберите вручную.`);
    }
  }

  // Ни одного поста в базе: объявление вышло до того, как бот начал их
  // запоминать, либо на площадки не уезжало вовсе.
  if (lines.length === 1) lines.push('Постов на площадках за этим объявлением не записано.');
  return lines;
}

// Поднять отложенное после перезапуска. Зовётся один раз при старте бота
// (см. telegram/index.js): таймеры и текст объявлений умерли вместе с прошлым
// процессом, а обещание «вернусь сам» осталось — и строки в базе вместе с ним.
//
// Объявления не разбираем прямо сейчас, а ставим на тот же срок, который
// назвала модель: лимит, из-за которого объявление и отложили, перезапуском не
// отпускает. Срок уже прошёл — park поставит минимальную паузу и вернётся к
// нему почти сразу.
async function restoreDeferred() {
  let rows;
  try {
    rows = await deferred.restorable();
  } catch (err) {
    console.error('[отложенное] не прочитать из базы:', err.message);
    return 0;
  }
  if (!rows.length) return 0;

  const byChat = new Map();
  for (const row of rows) {
    const message = { message_id: row.messageId };
    const ad = row.ad ? { message, text: row.text } : null;
    const job = parseJob(row.chatId, message, row.text, row.ad);
    park(row.chatId, job, row.retryAt, row.attempt, row.ad, ad, row.id);
    byChat.set(row.chatId, (byChat.get(row.chatId) || 0) + 1);
  }

  console.log(`[отложенное] после перезапуска вернул ${rows.length} объявление(й)`);
  // Говорим в тот же чат, где обещали вернуться: иначе выходит, что бот молчал
  // всё время простоя, а потом объявление появилось само и непонятно откуда.
  for (const [chatId, count] of byChat) {
    await tg
      .sendMessage(
        chatId,
        `♻️ Сервер перезапускался. Отложенных объявлений не потерял: ${count} — вернусь к ним, как обещал.`
      )
      .catch(() => {});
  }
  return rows.length;
}


// Отчёт по рекламе. Сделан так, чтобы его можно было переслать рекламодателю
// как есть: название, когда вышла, сколько набрала и выполнена ли гарантия.
function adReportText(campaign, totals, posts, { final }) {
  const link = (posts.find((post) => post.permalink) || {}).permalink;
  const hours = Math.max(1, Math.round(social.adTracker.ageOf(campaign) / 3600000));
  const goal = Number(campaign.goal) || social.adTracker.GOAL;
  const lines = [
    final ? '📊 Отчёт по рекламе в Threads' : `📊 Реклама в Threads — ${hours} ч с публикации`,
    `«${tg.esc(clamp(campaign.title || 'реклама', 80))}»`,
    `Вышла: ${whenText(campaign.created_at)}`,
    `👁 ${num(totals.views)} ${viewsWord(totals.views)} · ❤️ ${num(totals.likes)} · 💬 ${num(totals.replies)} · 🔁 ${num(
      totals.reposts + totals.quotes
    )}`,
  ];
  if (totals.boosts) lines.push(`Постов: ${totals.posts} (повторов: ${totals.boosts})`);
  if (totals.views >= goal) {
    lines.push(final ? `✅ Гарантия ${num(goal)}+ просмотров за сутки выполнена` : `✅ ${num(goal)} уже набрано`);
  } else {
    lines.push(
      final
        ? `⚠️ До гарантии ${num(goal)} не хватило ${num(goal - totals.views)}`
        : `До ${num(goal)} осталось ${num(goal - totals.views)}`
    );
  }
  if (link) lines.push(`<a href="${link}">Пост в Threads</a>`);
  return lines.join('\n');
}

function boostKeyboard(campaignId) {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '🔁 Поднять в Threads', callback_data: `ab:${campaignId}` }]],
    },
  };
}

// Итог через сутки. Если не дотянули — кнопка повтора: повтор после суток уже
// не «добирает» гарантию, но рекламодателю можно отдать обещанное.
async function onAdReport(campaign, totals, posts, { boostable }) {
  const goal = Number(campaign.goal) || social.adTracker.GOAL;
  const short = totals.views < goal;
  // Рекламодателю из директа отчёт уходит сам — но только выполненный: как
  // быть с недобором, решает админ, а не бот (см. onReport в src/dm).
  const client = await dm.onReport(campaign.id, totals, goal).catch((err) => {
    console.error('[директ] отчёт рекламодателю не ушёл:', err.message);
    return null;
  });
  const lines = [adReportText(campaign, totals, posts, { final: true })];
  if (client === 'sent') lines.push('', '✉️ Отчёт отправлен рекламодателю в директ Threads.');
  if (client === 'short') {
    lines.push('', '✉️ Рекламодателю из директа отчёт не отправлял — недобор. Поднимите рекламу или ответьте ему сами.');
  }
  await tg.sendMessage(campaign.chat_id, lines.join('\n'), short && boostable ? boostKeyboard(campaign.id) : undefined);
}

// Реклама отстаёт — предлагаем поднять, пока сутки не прошли.
async function onAdWarn(campaign, totals, posts, { boostable }) {
  const goal = Number(campaign.goal) || social.adTracker.GOAL;
  const hours = Math.round(social.adTracker.ageOf(campaign) / 3600000);
  const lines = [
    `⏳ Реклама «${tg.esc(clamp(campaign.title || 'реклама', 60))}» за ${hours} ч набрала ${num(totals.views)} ${viewsWord(
      totals.views
    )} — к суткам до ${num(goal)} может не дотянуть.`,
  ];
  if (boostable) lines.push('Поднять её повтором? Просмотры нового поста сложатся с этими.');
  await tg.sendMessage(campaign.chat_id, lines.join('\n'), boostable ? boostKeyboard(campaign.id) : undefined);
}

async function onAdStatsDenied() {
  await notifyAdmins(
    [
      '📊 Threads не отдаёт статистику постов: у токена нет разрешения threads_manage_insights.',
      'Отчёты по просмотрам рекламы заработают, когда это разрешение будет включено в приложении Meta',
      'и в Render будет вписан новый токен.',
    ].join('\n')
  );
}

// Заявка из ответов под постом (см. social/leads.js).
async function onLead(reply) {
  const lines = [
    '💬 Похоже на заявку на рекламу — ответ в Threads',
    `${reply.username ? `@${tg.esc(reply.username)}: ` : ''}«${tg.esc(clamp(reply.text, 400))}»`,
  ];
  if (reply.permalink) lines.push(`<a href="${reply.permalink}">Открыть и ответить</a>`);
  await notifyAdmins(lines.join('\n'));
}

async function onLeadsDenied() {
  await notifyAdmins(
    '💬 Ответы под постами Threads не читаются: у токена нет разрешения threads_read_replies — заявки из комментариев бот не видит.'
  );
}

// ИИ-продавец в директе Threads (см. src/dm). Сам разговор ведёт он, а сюда
// приходит то, что должен знать или решить админ: копия принятого чека, чек на
// проверку, просьба позвать человека.

const adminChat = () => [...ADMIN_IDS][0];
const peerName = (chat) => `@${tg.esc(chat.peer)}${chat.peer_name ? ` (${tg.esc(chat.peer_name)})` : ''}`;

const DM_STAGES = {
  new: 'только начал',
  offered: 'назвал цену',
  awaiting_payment: 'ждёт чек',
  awaiting_text: 'оплатил, ждёт текст',
  checking: 'чек на проверке',
  publishing: 'публикуется',
  published: 'реклама вышла',
  declined: 'отказался',
};

const RECEIPT_REASONS = {
  not_receipt: 'на картинке не чек',
  not_success: 'перевод не прошёл',
  amount: 'сумма меньше цены',
  recipient: 'получатель не наш',
  old: 'чек не свежий',
  duplicate: 'этот чек уже присылали',
};

// Что модель прочитала на чеке — одной строкой.
function checkLine(check) {
  if (!check) return 'Модель чек не прочитала — посмотрите сами.';
  const parts = [
    check.amount !== null ? `${num(check.amount)} ${check.currency && check.currency !== 'KGS' ? check.currency : 'сом'}` : 'сумма не видна',
    [check.recipient, check.account].filter(Boolean).join(' ') || 'получатель не виден',
    check.datetime || 'дата не видна',
    check.bank,
  ].filter(Boolean);
  return `Чек: ${tg.esc(parts.join(' · '))}`;
}

// Реклама, оплаченная в директе. Идёт тем же путём, что и «/ad»: сайт, канал,
// Threads, Instagram, отчёт по просмотрам. Сначала бот присылает объявление
// админу: с этого сообщения снимается копия в канал, у картинки появляется
// file_id для повтора рекламы, а у админа — карточка с кнопкой «Удалить».
async function publishFromDm({ chat, text, image }) {
  const chatId = adminChat();
  if (!chatId) throw new Error('не задан TELEGRAM_ADMIN_IDS');
  const abroad = abroadWork(text);
  if (abroad) return { refused: `работа за границей («${abroad}»)` };
  // Директ ведёт бот без админа — сетевой найм тут не пропускаем даже за деньги.
  const banned = spam.check(text);
  if (banned) return { refused: spam.describe(banned) };
  if (!image && text.length <= 15) throw new Error('в рекламе ни картинки, ни текста');

  const header = `📣 Реклама из директа Threads — ${peerName(chat)}`;
  const message = image
    ? await tg.sendPhoto(chatId, image, `${header}\n\n${tg.esc(clamp(text, 850))}`)
    : await tg.sendMessage(chatId, `${header}\n\n${tg.esc(text)}`);
  const result = await publishRawAd(chatId, message, text, image ? mediaOf(message) : null, true, {
    classify: true,
    dmChatId: chat.id,
  });
  return { threads: social.threadsConfigured(), siteLink: result.siteLink };
}

function dmKeyboard(rows) {
  return { reply_markup: { inline_keyboard: rows } };
}

async function onDmEvent(event) {
  const chatId = adminChat();
  if (!chatId) return;
  const { chat } = event;
  const who = chat ? peerName(chat) : '';

  switch (event.type) {
    case 'paid': {
      const lines = [
        `💰 Оплата рекламы в директе Threads — ${who}`,
        checkLine(event.check),
        ...(event.warnings || []).map((w) => `⚠️ ${tg.esc(w)}`),
        '',
        'Чек проверил ИИ по скриншоту — сверьте с МБанком. Если денег нет, снимите рекламу кнопкой «Удалить» под её карточкой.',
      ];
      await tg.sendPhoto(chatId, event.image, lines.join('\n').slice(0, 1024));
      return;
    }
    case 'review': {
      const lines = [
        `🧾 Чек из директа Threads — ${who} — нужна ваша проверка`,
        `Почему не принял сам: ${tg.esc(RECEIPT_REASONS[event.reason] || 'модель не смогла прочитать картинку')}`,
        checkLine(event.check),
        '',
        'Человеку сказал, что оплата на проверке.',
      ];
      await tg.sendPhoto(
        chatId,
        event.image,
        lines.join('\n').slice(0, 1024),
        dmKeyboard([
          [
            { text: '✅ Оплата есть — публиковать', callback_data: `dmok:${chat.id}` },
            { text: '❌ Оплаты нет', callback_data: `dmno:${chat.id}` },
          ],
        ])
      );
      return;
    }
    case 'handoff':
      await tg.sendMessage(
        chatId,
        [
          `🙋 Директ Threads — ${who} просит человека:`,
          `«${tg.esc(clamp(event.text || '', 600))}»`,
          '',
          'Бот в этом разговоре молчит 12 ч — ответьте в Threads сами.',
        ].join('\n'),
        dmKeyboard([[{ text: '🤖 Вернуть разговор боту', callback_data: `dmr:${chat.id}` }]])
      );
      return;
    case 'noMbank':
      await tg.sendMessage(
        chatId,
        `💳 ${who} в директе Threads согласился на рекламу, а номер МБанка не задан (MBANK_NUMBER в Render). Пришлите ему реквизиты сами.`
      );
      return;
    case 'forbidden':
      await tg.sendMessage(
        chatId,
        [`🚫 Директ Threads — ${who}: отказал, реклама похожа на запрещённую.`, `«${tg.esc(clamp(event.text || '', 600))}»`].join('\n')
      );
      return;
    case 'refused':
      await tg.sendMessage(
        chatId,
        `🚫 Оплаченную рекламу ${who} из директа не выложил: ${tg.esc(event.reason)}. Деньги получены — договоритесь с ним сами.`
      );
      return;
    case 'publishFailed':
      await tg.sendMessage(
        chatId,
        `⚠️ Оплаченная реклама ${who} из директа не вышла: ${tg.esc(event.error)}. Выложите её сами через /ad — человеку сказал, что администратор в курсе.`
      );
      return;
    case 'bridgeDown':
      await tg.sendMessage(
        chatId,
        '🔌 Автоответчик директа Threads молчит больше 30 минут. Проверьте, что компьютер включён, Chrome открыт, а в Threads вы вошли.'
      );
      return;
    case 'bridgeUp':
      await tg.sendMessage(chatId, '🔌 Автоответчик директа Threads снова на связи.');
      return;
    default:
      return;
  }
}


// /dm — как дела у автоответчика: жив ли мост, заданы ли реквизиты, о чём
// разговоры. Под списком — кнопки: забрать разговор себе или вернуть боту.
async function dmStatusText() {
  const { lastSync, chats } = await dm.status();
  const lines = ['🤖 Автоответчик директа Threads'];
  lines.push(
    lastSync ? `Расширение в Chrome: на связи ${agoText(Date.now() - lastSync)}` : 'Расширение в Chrome: с запуска сервера на связь не выходило'
  );
  if (!process.env.DM_BRIDGE_KEY) lines.push('⚠️ Не задан DM_BRIDGE_KEY — мост выключен');
  lines.push(process.env.MBANK_NUMBER ? '💳 Номер МБанка задан' : '⚠️ Не задан MBANK_NUMBER — реквизиты бот не пришлёт');

  const buttons = [];
  if (!chats.length) lines.push('', 'Разговоров пока не было.');
  else lines.push('', 'Разговоры:');
  for (const [i, chat] of chats.entries()) {
    const pausedNow = chat.paused_until && new Date(chat.paused_until).getTime() > Date.now();
    const last = [...(chat.history || [])].reverse().find((h) => h.from === 'them');
    lines.push(
      `${i + 1}. ${peerName(chat)} — ${DM_STAGES[chat.stage] || chat.stage}, ${agoText(Date.now() - new Date(chat.updated_at).getTime())}${
        pausedNow ? ' · ⏸ бот молчит' : ''
      }`
    );
    if (last && last.text) lines.push(`   «${tg.esc(clamp(last.text, 80))}»`);
    buttons.push(
      pausedNow
        ? { text: `▶️ ${i + 1}`, callback_data: `dmr:${chat.id}` }
        : { text: `⏸ ${i + 1}`, callback_data: `dmp:${chat.id}` }
    );
  }
  if (buttons.length) lines.push('', '⏸ — отвечу сам (бот молчит сутки), ▶️ — вернуть разговор боту.');
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(buttons.slice(i, i + 5));
  return { text: lines.join('\n'), extra: rows.length ? dmKeyboard(rows) : undefined };
}

// Запускается вместе с ботом (см. telegram/index.js): слежка за рекламой и за
// ответами в Threads отчитываются в Telegram, поэтому без бота им некуда.
function startWatchers() {
  // Список команд у синей кнопки «Меню» рядом с полем ввода.
  tg.call('setMyCommands', { commands: menu.COMMANDS }).catch((err) => console.error('Команды бота:', err.message));
  announceMenu().catch((err) => console.error('Меню бота:', err.message));
  social.adTracker.start({ onReport: onAdReport, onWarn: onAdWarn, onDenied: onAdStatsDenied });
  social.leads.start({ onLead, onDenied: onLeadsDenied });
  dm.start({ publish: publishFromDm, admin: onDmEvent });
  summary.start((text) => tg.sendMessage(process.env.SOURCE_REPORT_CHAT_ID || adminChat(), text), {
    extra: pendingLines,
  });
  products.start({
    report: (view) => tg.sendMessage(process.env.SOURCE_REPORT_CHAT_ID || adminChat(), view.text, view.extra),
  });
  adRaises.start({
    report: (chatId, text) => tg.sendMessage(chatId || adminChat(), text),
    siteLink: (ad) => prettyLink(adSiteUrl(ad)),
  });
}

// Повтор рекламы кнопкой. Выходит тем же постом, что и первый: с файлом
// рекламодателя (его заново берём из Telegram по file_id), с карточкой или
// просто текстом. Только в Threads — гарантию даём по нему.
async function boostAd(chatId, campaignId) {
  const campaign = await social.adTracker.get(Number(campaignId));
  if (!campaign) {
    await tg.sendMessage(chatId, '🔁 Этой рекламы уже нет в базе.');
    return;
  }
  if (!(await social.adTracker.canBoost(campaign))) {
    await tg.sendMessage(
      chatId,
      `🔁 «${tg.esc(clamp(campaign.title, 60))}» уже поднимали ${social.adTracker.MAX_BOOSTS} раза — больше не буду, это уже засоряет ленту.`
    );
    return;
  }

  let media = null;
  let card = null;
  const note = [];
  if ((campaign.media_kind === 'image' || campaign.media_kind === 'video') && campaign.media_file_id) {
    try {
      media = { kind: campaign.media_kind, buffer: await tg.downloadFile(campaign.media_file_id) };
    } catch (err) {
      note.push(`Файл рекламы не скачать (${tg.esc(err.message)}) — подниму текстом.`);
    }
  } else if (campaign.media_kind === 'card' && campaign.card) {
    card = typeof campaign.card === 'string' ? JSON.parse(campaign.card) : campaign.card;
  }

  const waiting = social.postToThreads(
    { text: campaign.threads_text, media, card },
    campaign.title,
    { chatId, campaignId: campaign.id, ad: true },
    { priority: true }
  );
  if (waiting === null) {
    await tg.sendMessage(chatId, '🧵 Threads не настроен — поднимать некуда.');
    return;
  }
  boostedAt.set(String(campaign.id), Date.now());
  await tg.sendMessage(
    chatId,
    [
      `🔁 Поднимаю «${tg.esc(clamp(campaign.title, 60))}» в Threads новым постом${
        waiting > 1 ? ` — ${waiting}-й в очереди` : ''
      }.`,
      'Просмотры сложатся с первым постом в отчёте.',
      ...note,
    ].join('\n')
  );
}

// Раздел меню — в том же сообщении, если его можно поправить, иначе новым.
// Поправить нельзя, если текст длиннее одного сообщения или сообщение старое.
async function show(chatId, view, messageId = null) {
  if (messageId && view.text.length <= 4096) {
    try {
      await tg.editMessageText(chatId, messageId, view.text, view.extra);
      return;
    } catch (err) {
      // Нажали «Обновить», а числа те же — Telegram отвечает ошибкой, и это не беда.
      if (/not modified/i.test(err.message)) return;
    }
  }
  await tg.sendMessage(chatId, view.text, view.extra);
}

async function sectionView(section) {
  switch (section) {
    case 'home':
      return menu.homeView();
    case 'ads':
      return adsListView(0);
    case 'stats':
      return menu.withBack({ text: await statsText() });
    case 'last':
      return publishedView();
    case 'spam':
      return menu.withBack(spamText());
    case 'groups':
      return menu.groupsView(await adGroups.overview());
    case 'products':
      return products.listView();
    case 'raise':
      return raiseSettingsView();
    case 'threads':
      return menu.withBack({ text: await threadsStatsText() });
    case 'limits':
      return menu.withBack({ text: await limitsText() });
    case 'dm':
      return menu.withBack(await dmStatusText());
    case 'top':
      return menu.withBack({ text: topPrompt(), extra: digestMenu() });
    case 'adhow':
      return menu.adHowView({
        warnHours: Math.round(social.adTracker.WARN_AFTER_MS / 3600000),
        goal: social.adTracker.GOAL,
      });
    default:
      return null;
  }
}

// messageId — нажали кнопку в меню: раздел встанет на его место.
async function openSection(chatId, section, messageId = null) {
  if (section === 'now') return onFlushCommand(chatId);
  if (section === 'help') return sendHelp(chatId);
  const view = await sectionView(section);
  if (view) await show(chatId, view, messageId);
  return null;
}

// Кнопки внизу экрана показываем один раз: Telegram помнит их сам, а
// напоминание при каждом /menu было бы шумом.
async function offerKeyboard(chatId) {
  const key = `menu:keyboard:${chatId}`;
  if (await feedStats.getSetting(key).catch(() => '1')) return;
  await tg.sendMessage(
    chatId,
    [
      '⌨️ Внизу экрана — кнопки: 📣 Реклама, 📊 Сводка, 📥 Из групп и ☰ Меню.',
      'В «📣 Реклама» — вся реклама, сначала новая: нажмите на любую, и увидите',
      'просмотры в Threads, где она вышла и что с группами Telegram.',
    ].join('\n'),
    menu.KEYBOARD
  );
  await feedStats.setSetting(key, '1').catch(() => {});
}

// Только что поднятая реклама: пока повтор ждёт очереди Threads, постов у
// кампании столько же, сколько было, и кнопка «Поднять» вернулась бы на месте.
const boostedAt = new Map();
const BOOST_GUARD_MS = 30 * 60 * 1000;
const justBoosted = (campaignId) => Date.now() - (boostedAt.get(String(campaignId)) || 0) < BOOST_GUARD_MS;

// «📣 Реклама» в меню и /ads: сначала новая. Числа у кампаний, по которым
// ещё не было отчёта, освежаем — трекер сам спрашивает Threads только на
// шестом часу и через сутки, и в списке висели бы нули.
async function adsListView(page = 0) {
  const total = await imports.countAds();
  const pages = Math.max(1, Math.ceil(total / menu.PAGE_SIZE));
  const current = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const rows = await imports.listAds({ limit: menu.PAGE_SIZE, offset: current * menu.PAGE_SIZE });
  for (const row of rows) {
    if (!row.campaign_id || row.reported_at) continue;
    try {
      const { totals } = await social.adTracker.refresh({ id: row.campaign_id });
      row.views = totals.views;
    } catch {
      // свежих нет — покажем записанные
    }
  }
  return menu.adsListView({ rows, page: current, pages, total, goal: social.adTracker.GOAL });
}

// «ℹ️» по рекламе: карточка на сайте, Threads, наш канал и группы Telegram.
async function adInfoView(importId, page = 0, { force = false, noBoost = false } = {}) {
  const ad = await imports.get(Number(importId));
  if (!ad) return menu.withBack({ text: '📣 Этой рекламы уже нет в базе.' });
  const campaign = await social.adTracker.byImport(ad.id).catch(() => null);
  let posts = [];
  let totals = null;
  let denied = false;
  let boostable = false;
  if (campaign) {
    try {
      ({ posts, totals } = await social.adTracker.refresh(campaign, { force }));
    } catch (err) {
      denied = Boolean(err.permission);
      posts = await social.adTracker.postsOf(campaign.id);
      totals = social.adTracker.totalsOf(posts);
    }
    boostable =
      !noBoost && ad.status === 'published' && !justBoosted(campaign.id) && (await social.adTracker.canBoost(campaign));
  }
  const [groups, channel] = await Promise.all([
    adGroups.forImport(ad.id, { views: true }).catch(() => []),
    ad.channel_message_id ? adGroups.channelViews(CHANNEL_ID, ad.channel_message_id).catch(() => null) : null,
  ]);
  const siteLink = adSiteUrl(ad);
  const raises = adRaises.summarize(await adRaises.rows(ad.id).catch(() => []));
  return menu.adInfoView({
    ad,
    campaign,
    posts,
    totals,
    denied,
    groups,
    channel,
    siteLink,
    siteLabel: prettyLink(siteLink),
    page: Number(page) || 0,
    boostable,
    goal: social.adTracker.GOAL,
    reportAfterMs: social.adTracker.REPORT_AFTER_MS,
    raises,
  });
}

// Адрес карточки рекламы на сайте — по тому, чем она стала.
function adSiteUrl(ad) {
  const type = ad.vacancy_id ? 'vacancy' : ad.order_id ? 'order' : ad.board_post_id ? 'board' : null;
  return type ? listingUrl(type, ad.vacancy_id || ad.order_id || ad.board_post_id) : '';
}

async function raiseSettingsView() {
  const plan = await adRaises.settings();
  return menu.raiseSettingsView(plan, {
    dayOptions: adRaises.DAY_OPTIONS,
    timePresets: adRaises.TIME_PRESETS,
    active: adRaises.active(plan),
  });
}

async function raisesView(importId, page = 0) {
  const ad = await imports.get(Number(importId));
  if (!ad) return menu.withBack({ text: '📣 Этой рекламы уже нет в базе.' });
  const list = await adRaises.rows(ad.id);
  return menu.raisesView({ ad, list, summary: adRaises.summarize(list), page: Number(page) || 0 });
}

// В боте появилось меню — один раз говорим об этом админу и показываем
// кнопки внизу экрана: иначе о нём узнали бы, только набрав /menu наугад.
async function announceMenu() {
  const chatId = adminChat();
  if (!chatId) return;
  await offerKeyboard(chatId);
}


// /threads — статистика аккаунта. Этими числами реклама и продаётся: в шапке
// профиля обещано «1000+ просмотров за сутки», и здесь видно, насколько
// обещание честное — сколько лента набирает в целом и в среднем на пост.
async function threadsStatsText() {
  if (!social.threadsConfigured()) return '🧵 Threads не настроен.';
  const now = Math.floor(Date.now() / 1000);
  let day;
  let week;
  try {
    [day, week] = await Promise.all([
      social.accountInsights({ since: now - 24 * 3600, until: now }),
      social.accountInsights({ since: now - 7 * 24 * 3600, until: now }),
    ]);
  } catch (err) {
    if (social.isPermissionError(err)) {
      return '🧵 Статистику Threads не отдаёт: у токена нет разрешения threads_manage_insights.';
    }
    return `🧵 Статистику Threads не получить: ${tg.esc(err.message)}`;
  }

  const [posts, ads] = await Promise.all([
    imports.countThreadsPosts(7).catch(() => 0),
    social.adTracker.summary(7).catch(() => ({ reported: 0, met: 0 })),
  ]);

  const lines = [
    '🧵 Threads',
    `За сутки: 👁 ${num(day.views)} · ❤️ ${num(day.likes)} · 💬 ${num(day.replies)}`,
    `За 7 дней: 👁 ${num(week.views)} · ❤️ ${num(week.likes)} · 💬 ${num(week.replies)} · 🔁 ${num(
      week.reposts + week.quotes
    )}`,
  ];
  if (week.followers !== null) lines.push(`Подписчиков: ${num(week.followers)}`);
  // Просмотры аккаунта — это все посты, а в posts только объявления бота;
  // посты руками из приложения сюда не попадают. Поэтому «примерно».
  if (posts) lines.push(`В среднем на пост за неделю: ≈${num(Math.round(week.views / posts))} (${num(posts)} постов)`);
  if (ads.reported) lines.push(`Реклама за неделю: ${ads.reported}, гарантию набрали ${ads.met}`);
  return lines.join('\n');
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
  restoreDeferred,
  startWatchers,
  isConfigured: () => tg.hasToken() && ADMIN_IDS.size > 0,
  // Тот же путь публикации, которым идут скриншоты из личных сообщений —
  // используется автоимпортом из чужого канала (см. sourceWatcher.js), чтобы
  // не заводить вторую копию логики очереди/дедупа/публикации/отчётов.
  ingestFromSource: handleParsed,
};

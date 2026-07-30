const { domainToUnicode } = require('url');

const tg = require('./api');
const extract = require('./extract');
const imports = require('./imports');
const queue = require('./queue');
const social = require('../social');
const EMPLOYMENT_TYPES = require('../employmentTypes');
const EXPERIENCE_LEVELS = require('../experienceLevels');

const EMPLOYMENT_LABELS = Object.fromEntries(EMPLOYMENT_TYPES.map((t) => [t.value, t.label]));
const EXPERIENCE_LABELS = Object.fromEntries(EXPERIENCE_LEVELS.map((t) => [t.value, t.label]));

// Кто имеет право публиковать через бота. Без этого списка любой, кто нашёл
// бота в поиске, смог бы залить на сайт что угодно.
const ADMIN_IDS = new Set(
  String(process.env.TELEGRAM_ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

const SITE_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
// Публичный канал, куда бот сам постит опубликованные объявления. Не задан —
// просто пропускаем этот шаг, остальная публикация работает как раньше.
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '';

function isAllowed(userId) {
  return ADMIN_IDS.has(String(userId));
}

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
    return `${domainToUnicode(u.host)}${u.pathname}${u.search}`.replace(/\/$/, '');
  } catch {
    return link;
  }
}

function publicText(parsed, listingType, siteLink) {
  const isVacancy = listingType === 'vacancy';
  const lines = [`${isVacancy ? '💼 Вакансия' : '🧰 Заказ'}: ${parsed.title || 'Без заголовка'}`, ''];

  const meta = [parsed.category, parsed.city].filter(Boolean).join(' · ');
  if (meta) lines.push(meta);
  if (isVacancy) {
    const empExp = [EMPLOYMENT_LABELS[parsed.employment_type], EXPERIENCE_LABELS[parsed.experience]]
      .filter(Boolean)
      .join(' · ');
    if (empExp) lines.push(empExp);
  }
  if (parsed.address) lines.push(`📍 ${parsed.address}`);
  if (parsed.budget) lines.push(`💰 ${parsed.budget} сом${isVacancy ? ' (от)' : ''}`);
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

// Ролик для Instagram и Threads делается уже после того, как объявление ушло на
// сайт: кодирование и обработка на стороне площадок занимают до пары минут, и
// держать ради них подтверждение публикации было бы странно. Поэтому шаг
// отдельный и отвечает своим сообщением, а его провал публикацию не отменяет.
const SITE_LABELS = { instagram: '📸 Instagram', threads: '🧵 Threads' };

function retryKeyboard(retryId) {
  return {
    reply_markup: {
      inline_keyboard: [[{ text: '🔁 Попробовать опубликовать ещё раз', callback_data: `rt:${retryId}` }]],
    },
  };
}

// Отчёт по площадкам. Площадка попадает в него, только если она настроена:
// строка «Threads: не настроен» под каждым объявлением была бы шумом, а не новостью.
function socialReport(result) {
  const sites = ['instagram', 'threads'].filter((name) => result[name]);
  const failed = sites.filter((name) => !result[name].posted);
  const lines = sites
    .filter((name) => result[name].posted)
    .map((name) => `${SITE_LABELS[name]}: опубликовано`);
  for (const name of failed) lines.push(`${SITE_LABELS[name]}: ${tg.esc(result[name].reason)}`);
  return { sites, failed, lines };
}

async function shareToSocial(chatId, parsed, listingType, siteLink) {
  try {
    const result = await social.shareListing(parsed, listingType, siteLink);
    const { sites, failed, lines } = socialReport(result);

    if (sites.length && !failed.length) {
      await tg.sendMessage(chatId, `${sites.map((n) => SITE_LABELS[n]).join(' и ')} — ролик опубликован`);
      return;
    }

    // Хоть где-то не вышло — отдаём готовый mp4 с подписью, чтобы можно было
    // выложить руками, и говорим, где именно не сработало. Ролик при этом
    // остаётся в памяти: чаще всего мешает сорвавшееся соединение до Meta, и со
    // второй попытки по кнопке он уходит сам.
    await tg.sendVideo(chatId, result.buffer, result.caption);
    if (!sites.length) lines.push(`🎬 Автопостинг не сработал: ${tg.esc(result.reason)}`);
    lines.push('Ролик выше — можно опубликовать вручную.');
    await tg.sendMessage(
      chatId,
      lines.join('\n'),
      result.retryId ? retryKeyboard(result.retryId) : undefined
    );
  } catch (err) {
    await tg.sendMessage(chatId, `⚠️ Ролик не собрался: ${tg.esc(err.message)}`);
  }
}

// Повтор по кнопке. Ролик уже собран и лежит в памяти процесса, заново кодировать
// его не надо — попытка занимает столько, сколько площадка обрабатывает видео.
async function retrySocial(chatId, retryId) {
  const result = await social.retry(retryId);
  if (!result) {
    await tg.sendMessage(
      chatId,
      '🎬 Ролик уже не в памяти (прошло больше сорока минут или сервер перезапускался) — выложите его вручную из сообщения выше.'
    );
    return;
  }

  const { failed, lines } = socialReport(result);
  if (!failed.length) {
    await tg.sendMessage(chatId, [...lines, '🔁 Со второй попытки получилось.'].join('\n'));
    return;
  }

  lines.push('Ролик выше — можно опубликовать вручную.');
  await tg.sendMessage(
    chatId,
    lines.join('\n'),
    result.retryId ? retryKeyboard(result.retryId) : undefined
  );
}

// Итог дня: сколько ушло на сайт и сколько роликов ещё едет на площадки.
// Второе число живёт только в памяти процесса — после перезапуска Render оно
// честно нулевое, потому что вместе с процессом умирают и сами сборки.
async function statsText() {
  const today = await imports.countToday();
  return `📊 Сегодня опубликовано: ${today}\n🎬 Роликов в работе: ${social.pending()}`;
}

// Публикует объявление сразу, ничего не переспрашивая. Недостающие поля
// достраивает imports.applyDefaults — что именно дописали, показываем в ответе,
// чтобы подмена города или категории не прошла незамеченной.
async function publishOne(chatId, id, parsed) {
  const { parsed: ready, filled } = await imports.applyDefaults(parsed);
  if (filled.length) await imports.setParsed(id, ready);

  const result = await imports.publish(id);
  const path = result.type === 'vacancy' ? 'vacancies' : 'orders';
  const siteLink = SITE_URL ? `${SITE_URL}/${path}/${result.id}` : '';
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
  const lines = ['✅ Опубликовано', '', `${tg.esc(clamp(body, 3000))}${linkTag}`, ''];
  if (channelLine) lines.push(channelLine);
  lines.push(`📱 <a href="${waLink}">Отправить в WhatsApp</a>`);
  // Без телефона объявление живое, но откликнуться на него нельзя — это стоит
  // увидеть сразу, пока кнопка удаления рядом.
  if (!ready.phone) lines.push('⚠️ Телефона нет — откликнуться будет некуда');
  if (filled.length) lines.push(`✍️ Дописал сам: ${tg.esc(filled.join(', '))}`);

  const sent = await tg.sendMessage(chatId, lines.join('\n'), {
    reply_markup: { inline_keyboard: [[{ text: '🗑 Удалить с сайта', callback_data: `del:${id}` }]] },
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
    await tg.sendMessage(chatId, `🚫 Не похоже на заказ или вакансию.${note ? `\n${tg.esc(note)}` : ''}`);
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
      await tg.sendMessage(chatId, `♻️ «${tg.esc(parsed.title || 'без названия')}» уже приходило раньше — пропускаю.`);
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
        'Чего не хватает — дописываю сам (город → Бишкек, категория → Другое)',
        'и пишу об этом в ответе. В ответ присылаю текст объявления целиком,',
        'как он ушёл на сайт, и кнопку 🗑 «Удалить с сайта» — прочитал, и если',
        'в разбор попало лишнее, сразу убрал.',
        '',
        'Если ролик не ушёл в Instagram или Threads (у Meta часто рвётся соединение),',
        'пришлю сам ролик и кнопку 🔁 «Попробовать опубликовать ещё раз» —',
        'нажал, и он поедет заново, без пересборки.',
        '',
        'Пачку скриншотов можно кинуть разом: поставлю в очередь и разберу по одному',
        '(бесплатный Groq за минуту успевает примерно полтора скриншота).',
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

module.exports = { handleUpdate, isConfigured: () => tg.hasToken() && ADMIN_IDS.size > 0 };

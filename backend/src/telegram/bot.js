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

// Ролик для Instagram делается уже после того, как объявление ушло на сайт:
// кодирование и обработка на стороне Instagram занимают до пары минут, и держать
// ради них подтверждение публикации было бы странно. Поэтому шаг отдельный и
// отвечает своим сообщением, а его провал публикацию на сайте не отменяет.
async function shareToInstagram(chatId, parsed, listingType) {
  try {
    const result = await social.shareListing(parsed, listingType);
    if (result.posted) {
      await tg.sendMessage(chatId, '📸 Ролик опубликован в Instagram');
      return;
    }
    // Не выложилось — отдаём готовый mp4 с подписью, чтобы можно было запостить руками
    await tg.sendVideo(chatId, result.buffer, result.caption);
    await tg.sendMessage(chatId, `📸 В Instagram сам не выложил: ${tg.esc(result.reason)}\nРолик выше — можно опубликовать вручную.`);
  } catch (err) {
    await tg.sendMessage(chatId, `⚠️ Ролик не собрался: ${tg.esc(err.message)}`);
  }
}

// Итог дня: сколько ушло на сайт и сколько роликов ещё едет в Instagram.
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
  const publicMsg = publicText(ready, result.type, siteLink);

  // Канал — необязательный шаг: если пост туда не ушёл (бот не админ, канал
  // не задан), публикация на сайте всё равно должна засчитаться.
  let channelLine = '';
  if (CHANNEL_ID) {
    try {
      await tg.sendMessage(CHANNEL_ID, tg.esc(publicMsg));
      channelLine = '📢 Выложено в Telegram-канал';
    } catch (err) {
      channelLine = `⚠️ В канал не ушло: ${tg.esc(err.message)}`;
    }
  }

  // wa.me/?text= открывает выбор чата в WhatsApp с готовым текстом — куда
  // отправить, решает админ: автопостинга в каналы WhatsApp у Meta нет.
  const waLink = `https://wa.me/?text=${encodeURIComponent(publicMsg)}`;

  const lines = [`✅ <b>${tg.esc(ready.title)}</b>`];
  if (siteLink) lines.push(tg.esc(siteLink));
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
  // не должно ждать кодирования и загрузки в Instagram.
  shareToInstagram(chatId, ready, result.type).catch((err) => console.error('Instagram:', err));
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
        'в Telegram-канал и роликом в Instagram. Если объявлений на скриншоте',
        'несколько — опубликую каждое.',
        '',
        'Чего не хватает — дописываю сам (город → Бишкек, категория → Другое)',
        'и пишу об этом в ответе. Под каждым объявлением кнопка 🗑 «Удалить',
        'с сайта» — на случай, если в разбор попало лишнее.',
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
  const id = parseInt(rawId, 10);
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

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
        `🗑 <b>${tg.esc(row.parsed.title || 'без названия')}</b>\nУдалено с сайта.\n\n⚠️ В Telegram-канале и в Instagram пост остаётся — их надо убрать вручную.`
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

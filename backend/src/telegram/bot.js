const tg = require('./api');
const extract = require('./extract');
const imports = require('./imports');

// Кто имеет право публиковать через бота. Без этого списка любой, кто нашёл
// бота в поиске, смог бы залить на сайт что угодно.
const ADMIN_IDS = new Set(
  String(process.env.TELEGRAM_ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

const SITE_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

// Кто из администраторов сейчас правит какое объявление. В памяти процесса:
// перезапуск сбрасывает режим правки, и это ровно то, чего от него ждёшь —
// карточка остаётся, кнопки на месте, «Исправить» можно нажать заново.
const editing = new Map();

function isAllowed(userId) {
  return ADMIN_IDS.has(String(userId));
}

function card(parsed, extra) {
  const lines = [`📋 <b>${tg.esc(parsed.title || 'Без заголовка')}</b>`, ''];

  const meta = [parsed.category, parsed.city].filter(Boolean).join(' · ');
  if (meta) lines.push(tg.esc(meta));
  if (parsed.address) lines.push(`📍 ${tg.esc(parsed.address)}`);
  if (parsed.budget) lines.push(`💰 ${parsed.budget} сом`);
  if (parsed.phone) lines.push(`📞 ${tg.esc(parsed.phone)}`);
  if (parsed.work_format === 'online') lines.push('💻 Удалённо');

  if (parsed.description) lines.push('', tg.esc(parsed.description));
  if (parsed.note) lines.push('', `⚠️ ${tg.esc(parsed.note)}`);
  if (extra) lines.push('', extra);

  return lines.join('\n');
}

function keyboard(id) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Опубликовать', callback_data: `pub:${id}` },
        { text: '✏️ Исправить', callback_data: `edit:${id}` },
      ],
      [{ text: '❌ Мусор', callback_data: `rej:${id}` }],
    ],
  };
}

async function showCard(chatId, id, parsed) {
  const problems = await imports.validate(parsed);
  const warning = problems.length ? `❗ Не хватает: ${tg.esc(problems.join(', '))}` : '';
  const sent = await tg.sendMessage(chatId, card(parsed, warning), {
    reply_markup: keyboard(id),
  });
  await imports.setCard(id, chatId, sent.message_id);
}

async function handleParsed(chatId, parsed, { source, rawText }) {
  if (!parsed.is_listing || parsed.listing_type === 'other') {
    await tg.sendMessage(
      chatId,
      `🚫 Это не похоже на заказ.${parsed.note ? `\n${tg.esc(parsed.note)}` : ''}`
    );
    return;
  }
  if (parsed.listing_type === 'vacancy') {
    // Вакансии живут в отдельной таблице со своим набором полей (график, опыт,
    // вилка зарплаты) — их импорт будет отдельным шагом, а пока честно говорим.
    await tg.sendMessage(chatId, '💼 Это вакансия, а не заказ. Импорт вакансий пока не сделан.');
    return;
  }

  const id = await imports.create({ source, rawText, parsed, chatId });
  if (id === null) {
    await tg.sendMessage(chatId, '♻️ Это объявление уже приходило раньше — пропускаю.');
    return;
  }
  await showCard(chatId, id, parsed);
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
    await tg.sendMessage(chatId, `Этот бот только для администраторов Шабашки.\nВаш ID: ${userId}`);
    return;
  }

  const text = (message.text || message.caption || '').trim();

  if (text === '/start' || text === '/help') {
    await tg.sendMessage(
      chatId,
      [
        '👋 Присылай скриншот объявления из WhatsApp или пересылай сообщение из чата.',
        '',
        'Я разберу его на поля и покажу карточку с кнопками:',
        '✅ Опубликовать — заказ уходит на сайт',
        '✏️ Исправить — напиши, что поменять («город Ош», «убери телефон»)',
        '❌ Мусор — просто выбросить',
      ].join('\n')
    );
    return;
  }

  // Режим правки: следующее текстовое сообщение — это правки к карточке
  const editingId = editing.get(userId);
  if (editingId && text && !photoFileId(message)) {
    editing.delete(userId);
    const row = await imports.get(editingId);
    if (!row) {
      await tg.sendMessage(chatId, 'Это объявление уже не найти.');
      return;
    }
    const parsed = await extract.applyCorrections(row.parsed, text);
    await imports.setParsed(editingId, parsed);
    await showCard(chatId, editingId, parsed);
    return;
  }

  const fileId = photoFileId(message);
  if (fileId) {
    // Прислали новый скриншот вместо правок — значит, правки отменились. Иначе
    // флаг остался бы висеть и следующий текст ушёл бы в правки старой карточки.
    editing.delete(userId);
    await tg.sendMessage(chatId, '🔍 Читаю скриншот…');
    const buffer = await tg.downloadFile(fileId);
    const mediaType =
      message.document && message.document.mime_type ? message.document.mime_type : 'image/jpeg';
    const parsed = await extract.fromImage(buffer, mediaType);
    await handleParsed(chatId, parsed, { source: 'whatsapp', rawText: text || null });
    return;
  }

  if (text.length > 15) {
    const parsed = await extract.fromText(text);
    await handleParsed(chatId, parsed, { source: 'telegram', rawText: text });
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

  if (action === 'edit') {
    editing.set(userId, id);
    await tg.answerCallbackQuery(query.id, 'Жду правки');
    await tg.sendMessage(
      chatId,
      '✏️ Напиши, что поменять. Например: «город Ош», «бюджет 3000», «убери телефон».'
    );
    return;
  }

  if (action === 'rej') {
    await imports.reject(id);
    await tg.answerCallbackQuery(query.id, 'Выброшено');
    await tg.editMessageText(chatId, messageId, `${card(row.parsed)}\n\n❌ <b>Выброшено</b>`);
    return;
  }

  if (action === 'pub') {
    try {
      const orderId = await imports.publish(id);
      const link = SITE_URL ? `\n${SITE_URL}/orders/${orderId}` : '';
      await tg.answerCallbackQuery(query.id, 'Опубликовано');
      await tg.editMessageText(
        chatId,
        messageId,
        `${card(row.parsed)}\n\n✅ <b>Опубликовано</b>${tg.esc(link)}`
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

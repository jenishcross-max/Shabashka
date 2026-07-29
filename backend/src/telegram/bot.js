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

// Кто из администраторов сейчас правит какое объявление. В памяти процесса:
// перезапуск сбрасывает режим правки, и это ровно то, чего от него ждёшь —
// карточка остаётся, кнопки на месте, «Исправить» можно нажать заново.
const editing = new Map();

function isAllowed(userId) {
  return ADMIN_IDS.has(String(userId));
}

function card(parsed, extra) {
  const isVacancy = parsed.listing_type === 'vacancy';
  const typeLabel = isVacancy ? '💼 Вакансия' : '🧰 Заказ';
  const lines = [`${typeLabel}: <b>${tg.esc(parsed.title || 'Без заголовка')}</b>`, ''];

  const meta = [parsed.category, parsed.city].filter(Boolean).join(' · ');
  if (meta) lines.push(tg.esc(meta));
  if (isVacancy) {
    const empExp = [EMPLOYMENT_LABELS[parsed.employment_type], EXPERIENCE_LABELS[parsed.experience]]
      .filter(Boolean)
      .join(' · ');
    if (empExp) lines.push(tg.esc(empExp));
  }
  if (parsed.address) lines.push(`📍 ${tg.esc(parsed.address)}`);
  if (parsed.budget) lines.push(`💰 ${parsed.budget} сом${isVacancy ? ' (от)' : ''}`);
  if (parsed.phone) lines.push(`📞 ${tg.esc(parsed.phone)}`);
  if (parsed.work_format === 'online') lines.push('💻 Удалённо');

  if (parsed.description) lines.push('', tg.esc(parsed.description));
  if (parsed.note) lines.push('', `⚠️ ${tg.esc(parsed.note)}`);
  if (extra) lines.push('', extra);

  return lines.join('\n');
}

// Публичная версия карточки — без внутренних пометок вроде ⚠️ note, которые
// имеют смысл только для админа при модерации. Возвращает обычный текст без
// HTML-разметки: caller сам решает, экранировать его для Telegram или взять
// как есть для wa.me-ссылки.
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

function keyboard(id, listingType) {
  const toggleLabel = listingType === 'vacancy' ? '🔄 Это заказ' : '🔄 Это вакансия';
  return {
    inline_keyboard: [
      [
        { text: '✅ Опубликовать', callback_data: `pub:${id}` },
        { text: '✏️ Исправить', callback_data: `edit:${id}` },
      ],
      [
        { text: toggleLabel, callback_data: `type:${id}` },
        { text: '❌ Мусор', callback_data: `rej:${id}` },
      ],
    ],
  };
}

async function showCard(chatId, id, parsed) {
  const problems = await imports.validate(parsed);
  const warning = problems.length ? `❗ Не хватает: ${tg.esc(problems.join(', '))}` : '';
  const sent = await tg.sendMessage(chatId, card(parsed, warning), {
    reply_markup: keyboard(id, parsed.listing_type),
  });
  await imports.setCard(id, chatId, sent.message_id);
}

async function handleParsed(chatId, listings, { source, rawText }) {
  const real = listings.filter((p) => p.is_listing && p.listing_type !== 'other');
  if (real.length === 0) {
    const note = listings[0] && listings[0].note;
    await tg.sendMessage(chatId, `🚫 Не похоже на заказ или вакансию.${note ? `\n${tg.esc(note)}` : ''}`);
    return;
  }

  for (const parsed of real) {
    const id = await imports.create({ source, rawText, parsed, chatId });
    if (id === null) {
      await tg.sendMessage(chatId, `♻️ «${tg.esc(parsed.title || 'без названия')}» уже приходило раньше — пропускаю.`);
      continue;
    }
    await showCard(chatId, id, parsed);
  }
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
        'Если объявлений несколько сразу — разберу каждое отдельной карточкой.',
        'Пачку скриншотов можно кинуть разом: поставлю в очередь и разберу по одному',
        '(бесплатный Groq за минуту успевает примерно полтора скриншота).',
        '',
        'На карточке кнопки:',
        '✅ Опубликовать — уходит на сайт (заказ или вакансия)',
        '✏️ Исправить — напиши, что поменять («город Ош», «убери телефон»)',
        '🔄 Это вакансия / Это заказ — если тип определили неправильно',
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

  if (action === 'edit') {
    editing.set(userId, id);
    await tg.answerCallbackQuery(query.id, 'Жду правки');
    await tg.sendMessage(
      chatId,
      '✏️ Напиши, что поменять. Например: «город Ош», «бюджет 3000», «убери телефон».'
    );
    return;
  }

  if (action === 'type') {
    const newType = row.parsed.listing_type === 'vacancy' ? 'order' : 'vacancy';
    const parsed = { ...row.parsed, listing_type: newType };
    await imports.setParsed(id, parsed);
    const problems = await imports.validate(parsed);
    const warning = problems.length ? `❗ Не хватает: ${tg.esc(problems.join(', '))}` : '';
    await tg.answerCallbackQuery(query.id, newType === 'vacancy' ? 'Теперь вакансия' : 'Теперь заказ');
    await tg.editMessageText(chatId, messageId, card(parsed, warning), {
      reply_markup: keyboard(id, newType),
    });
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
      const result = await imports.publish(id);
      const path = result.type === 'vacancy' ? 'vacancies' : 'orders';
      const siteLink = SITE_URL ? `${SITE_URL}/${path}/${result.id}` : '';
      const publicMsg = publicText(row.parsed, result.type, siteLink);

      // Канал — необязательный шаг: если пост туда не ушёл (бот не админ,
      // канал не задан), публикация на сайте всё равно должна засчитаться.
      let channelNote = '';
      if (CHANNEL_ID) {
        try {
          await tg.sendMessage(CHANNEL_ID, tg.esc(publicMsg));
        } catch (err) {
          channelNote = `\n⚠️ В канал не ушло: ${tg.esc(err.message)}`;
        }
      }

      // wa.me/?text= открывает у админа выбор чата в WhatsApp с готовым
      // текстом — свой канал он выбирает и отправляет сам, автопостинга
      // в WhatsApp-каналы у Meta просто нет.
      const waLink = `https://wa.me/?text=${encodeURIComponent(publicMsg)}`;

      await tg.answerCallbackQuery(query.id, 'Опубликовано');
      await tg.editMessageText(
        chatId,
        messageId,
        `${card(row.parsed)}\n\n✅ <b>Опубликовано</b>${siteLink ? `\n${tg.esc(siteLink)}` : ''}${channelNote}\n\n📱 <a href="${waLink}">Отправить в WhatsApp</a>\n🎬 Собираю ролик для Instagram…`
      );

      // Намеренно без await: ролик едет своим ходом, а обработчик кнопки на нём
      // не висит — иначе long polling встал бы на всё время кодирования.
      shareToInstagram(chatId, row.parsed, result.type).catch((err) =>
        console.error('Instagram:', err)
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

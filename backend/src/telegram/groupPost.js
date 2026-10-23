// «✍️ Написать в группу» — сообщение админа от имени Шабашки в группу, куда бот
// выкладывает объявления (TELEGRAM_CHANNEL_ID).
//
// Писать туда со своего аккаунта неудобно: участники видят незнакомое имя и не
// понимают, что это сама Шабашка. От бота сообщение выходит с тем же именем и
// аватаром, что у каждого объявления в группе.
//
// Только в свою группу. В чужие пишет юзер-сессия (см. adGroups.js), и пачка
// одинаковых сообщений от неё — прямой повод для бана.
//
// Сначала спрашиваем «Отправить?»: сообщение увидит вся группа, а убрать его
// потом можно только руками. Копией, а не своей отправкой — так доходит всё,
// что прислали: фото, видео, альбомная подпись, жирный текст.

const TTL_MS = 15 * 60 * 1000;

// chatId → до какого времени ждём сообщение. В памяти: после перезапуска
// достаточно нажать кнопку ещё раз.
const waiting = new Map();
// Уже отправленные — чтобы двойное нажатие не выложило пост дважды.
const done = new Set();

const PROMPT = [
  '✍️ <b>Написать в группу</b>',
  '',
  'Пришлите сообщение следующим: текст, фото или видео с подписью. Выйдет от имени бота Шабашки — как объявления.',
  'Перед отправкой переспрошу. /cancel — отменить.',
].join('\n');

async function prompt(chatId, deps) {
  if (!deps.channelId) {
    await deps.send(chatId, '⚠️ Группа не задана: нужен TELEGRAM_CHANNEL_ID на Render.');
    return;
  }
  waiting.set(chatId, Date.now() + TTL_MS);
  await deps.send(chatId, PROMPT);
}

// Сообщение админа. true — наше, дальше его не разбирать.
async function onMessage(message, deps, { isMenuKey = () => false } = {}) {
  const chatId = message.chat.id;
  const until = waiting.get(chatId);
  if (!until) return false;
  if (until < Date.now()) {
    waiting.delete(chatId);
    return false;
  }

  const text = (message.text || '').trim();
  if (/^\/cancel\b/i.test(text)) {
    waiting.delete(chatId);
    await deps.send(chatId, 'Ок, отменил.');
    return true;
  }
  // Команда или кнопка меню — админ занялся другим. Выложить «/stats» в
  // группу было бы хуже, чем переспросить.
  if (text.startsWith('/') || isMenuKey(text)) {
    waiting.delete(chatId);
    return false;
  }

  waiting.delete(chatId);
  const id = message.message_id;
  await deps.send(chatId, 'Отправить это в группу от имени Шабашки?', {
    reply_to_message_id: id,
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Отправить', callback_data: `gp:send:${id}` },
          { text: '✖️ Отмена', callback_data: `gp:no:${id}` },
        ],
      ],
    },
  });
  return true;
}

// Кнопки. true — наша.
async function onCallback(query, deps) {
  const [scope, action, rawId] = String(query.data || '').split(':');
  if (scope !== 'gp') return false;
  const chatId = query.message.chat.id;

  if (action === 'start') {
    await deps.answer(query.id, '');
    await prompt(chatId, deps);
    return true;
  }

  const id = Number(rawId);
  const key = `${chatId}:${id}`;
  if (action === 'no') {
    await deps.answer(query.id, 'Отменил');
    await deps.edit(chatId, query.message.message_id, 'Не отправлял.');
    return true;
  }
  if (action !== 'send' || !id) return false;

  if (done.has(key)) {
    await deps.answer(query.id, 'Уже отправлено');
    return true;
  }
  done.add(key);
  try {
    await deps.copy(deps.channelId, chatId, id);
  } catch (err) {
    done.delete(key);
    await deps.answer(query.id, 'Не ушло');
    await deps.send(chatId, `⚠️ В группу не ушло: ${deps.esc(err.message)}`);
    return true;
  }
  await deps.answer(query.id, 'Отправлено');
  await deps.edit(chatId, query.message.message_id, '✅ Отправлено в группу.');
  return true;
}

module.exports = { prompt, onMessage, onCallback, TTL_MS };

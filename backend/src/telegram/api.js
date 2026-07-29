// Тонкая обёртка над Telegram Bot API. Полноценная библиотека тут не нужна:
// боту хватает шести методов, а лишняя зависимость — лишний повод для поломки
// на деплое.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const BASE = `https://api.telegram.org/bot${TOKEN}`;

async function call(method, payload) {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram ${method}: ${data.description || res.status}`);
  }
  return data.result;
}

// Экранирование под parse_mode=HTML — единственный режим, который не ломается
// от случайных подчёркиваний и звёздочек в чужом тексте объявления.
function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sendMessage(chatId, text, extra) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

function editMessageText(chatId, messageId, text, extra) {
  return call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

function answerCallbackQuery(id, text) {
  return call('answerCallbackQuery', { callback_query_id: id, text: text || '' });
}

// Картинка приходит как file_id — реальный файл нужно забрать в два шага.
async function downloadFile(fileId) {
  const file = await call('getFile', { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`);
  if (!res.ok) throw new Error(`Не удалось скачать файл: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = {
  call,
  esc,
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  downloadFile,
  hasToken: () => Boolean(TOKEN),
};

// Подмена модулей для тестов и защита от похода в настоящую базу.
//
// Базы у тестов нет и быть не должно: DATABASE_URL в backend/.env указывает на
// боевой Supabase, и тест, который случайно до него дотянется, напишет или
// удалит что-нибудь в живых объявлениях. Поэтому любой require внутри src/db
// здесь падает с внятной ошибкой, а модулям, которым база всё-таки нужна,
// подсовывается заглушка.
const Module = require('module');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'src');

// Путь к модулю проекта: at('telegram/bot.js').
const at = (p) => path.resolve(SRC, p);

let installed = false;
const original = Module._load;

// stubs — { путь: экспорт }. Возвращает функцию require для модулей проекта:
// подменять надо ДО того, как их загрузят, поэтому сам модуль тоже берём отсюда.
function install(stubs = {}) {
  if (!installed) {
    installed = true;
    Module._load = function load(request, parent, isMain) {
      let file;
      try {
        file = Module._resolveFilename(request, parent, isMain);
      } catch {
        return original.apply(this, arguments);
      }
      if (file in stubs) return stubs[file];
      if (file.startsWith(at('db'))) {
        throw new Error(`тест полез в настоящую базу: ${file}`);
      }
      return original.apply(this, arguments);
    };
  }
  return (p) => require(at(p));
}

// Копилка сообщений: почти каждому тесту бота нужно одно и то же — узнать,
// что бот сказал в чат.
function chat() {
  const sent = [];
  return {
    sent,
    api: {
      hasToken: () => true,
      esc: (s) => String(s ?? ''),
      call: async () => ({ ok: true }),
      answerCallbackQuery: async () => {},
      sendMessage: async (chatId, text) => {
        sent.push(String(text));
        return { message_id: 100 + sent.length };
      },
      editMessageText: async () => {},
      copyMessage: async () => ({ message_id: 2 }),
      downloadFile: async () => Buffer.from('файл'),
      sendVideo: async () => ({ message_id: 3 }),
    },
    has: (re) => sent.some((t) => re.test(t)),
    count: (re) => sent.filter((t) => re.test(t)).length,
    clear: () => {
      sent.length = 0;
    },
    dump: () => sent.join(' | '),
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { install, at, chat, wait, SRC };

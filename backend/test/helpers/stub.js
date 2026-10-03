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
      sendPhoto: async (chatId, buffer, caption) => {
        sent.push(String(caption || ''));
        return { message_id: 100 + sent.length, photo: [{ file_id: 'фото' }], chat: { id: chatId } };
      },
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

// ИИ-продавец директа (src/dm) целиком живёт в базе. Тестам бота он нужен
// только как «есть и молчит».
function dmStub(extra = {}) {
  return {
    start: () => {},
    onPosted: async () => {},
    onReport: async () => null,
    status: async () => ({ lastSync: 0, chats: [] }),
    approve: async () => 'публикую',
    reject: async () => 'сказал, что оплаты нет',
    pause: async () => true,
    resume: async () => true,
    ...extra,
  };
}

// Счётчики сводки и чёрный список номеров живут в базе (см. feedStats.js и
// blocklist.js). Тестам бота хватает копилки: что посчитали и какие номера
// запомнили.
function statsStub() {
  const counters = {};
  const blocked = new Set();
  const bump = async (key, n = 1) => {
    counters[key] = (counters[key] || 0) + n;
  };
  const phonesIn = (text) =>
    (String(text || '').match(/\d[\d\s()+\-.]{6,}\d/g) || [])
      .map((chunk) => chunk.replace(/\D/g, '').replace(/^996|^0/, ''))
      .filter((digits) => digits.length === 9)
      .map((digits) => `+996${digits}`);
  return {
    counters,
    blocked,
    feedStats: {
      bump,
      day: async () => ({ ...counters }),
      today: () => '2026-10-03',
      reasonOf: (listing) => listing.spam || (listing.abroad ? 'abroad' : 'other'),
      fail: async () => bump('grp.fail'),
      lastFailure: () => null,
      getSetting: async () => null,
      setSetting: async () => {},
    },
    blocklist: {
      phonesIn,
      blockedIn: async (text) => phonesIn(text).find((phone) => blocked.has(phone)) || null,
      add: async (phones) => {
        for (const phone of phones) blocked.add(phone);
        return phones.length;
      },
      remove: async (phones) => {
        for (const phone of phones) blocked.delete(phone);
        return phones.length;
      },
      size: async () => blocked.size,
      DEFAULT_DAYS: 30,
    },
  };
}

// Реклама в группах Telegram (см. telegram/adGroups.js) — это юзер-сессия и
// база. Тестам бота хватает записи: что поставили в очередь, что сняли.
function adGroupsStub(extra = {}) {
  const queued = [];
  const removed = [];
  return {
    queued,
    removed,
    start: async () => {},
    isOwn: () => false,
    enqueue: async (args) => {
      queued.push(args);
      return { queued: 0, silent: true };
    },
    forImport: async () => [],
    channelViews: async () => null,
    unpublish: async (importId) => {
      removed.push(importId);
      return { cancelled: 0, deleted: 0, failed: [] };
    },
    overview: async () => ({
      enabled: true,
      connected: false,
      account: null,
      separate: false,
      restrictedUntil: null,
      groups: [],
      gapSec: 40,
      cooldownMin: 60,
      brokenHours: 24,
    }),
    setEnabled: async () => {},
    toggle: async () => null,
    TARGETS: [],
    GAP_MS: 40000,
    COOLDOWN_MS: 60 * 60 * 1000,
    ...extra,
  };
}

module.exports = { install, at, chat, wait, dmStub, statsStub, adGroupsStub, SRC };

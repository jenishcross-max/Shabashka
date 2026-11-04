// WhatsApp-канал Шабашки: бот сам выкладывает туда подборки (см. digest.js).
//
// Официального API у каналов WhatsApp нет. Поэтому бот входит в WhatsApp как
// «связанное устройство» второго номера, так же как WhatsApp Web, через
// неофициальную библиотеку Baileys. Номер отдельный, не владельца: за
// неофициальный клиент WhatsApp может заблокировать номер, и тогда потеряется
// только он. Номер должен быть админом канала.
//
// Привязка — кодом, а не QR: QR с сервера Render не показать. Админ пишет боту
// /whatsapp link, бот присылает 8 знаков, их вводят на втором телефоне.
//
// Ошибки отсюда не роняют бота: WhatsApp — добавка к остальным площадкам.

const RECONNECT_MIN_MS = 5 * 1000;
const RECONNECT_MAX_MS = 5 * 60 * 1000;
const OPEN_WAIT_MS = 60 * 1000;
const PAIRING_WAIT_MS = 30 * 1000;

// Baileys пишет в лог каждое сообщение протокола — нам хватает своих строк.
const SILENT = {
  level: 'silent',
  child: () => SILENT,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};

// «https://whatsapp.com/channel/0029Vb…» или сам код — в код.
function inviteCode(value) {
  const match = String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .match(/(?:^|\/)([A-Za-z0-9]{20,})$/);
  return match ? match[1] : '';
}

// Зависимости — параметрами, чтобы тест подставил поддельный WhatsApp. Вход
// в базе (auth.js) берём лениво: без WA_CHANNEL модуль базы не трогает.
function createChannel({
  invite,
  phone,
  notify = async () => {},
  load = () => import('@whiskeysockets/baileys'),
  authState = (lib) => require('./auth').useDbAuthState(lib),
  clearAuth = () => require('./auth').clear(),
  later = (fn, ms) => setTimeout(fn, ms).unref(),
} = {}) {
  const code = inviteCode(invite);
  const number = String(phone || '').replace(/\D/g, '');
  // off | unlinked | linking | connecting | open | replaced
  let status = code ? 'unlinked' : 'off';
  let sock = null;
  // Вход — один на процесс, как в примерах Baileys: читать его из базы на каждом
  // переподключении значило бы рисковать не дождаться записи после привязки.
  let auth = null;
  let jid = '';
  let name = '';
  let lastError = '';
  let attempt = 0;
  let linking = false;
  let pairing = null;
  let waiting = [];
  let pending = null;

  const fail = (err) => {
    lastError = err.message;
    console.error('[whatsapp]', err.message);
  };

  function settle(err) {
    const list = waiting;
    waiting = [];
    for (const waiter of list) {
      if (err) waiter.reject(err);
      else waiter.resolve();
    }
  }

  function drop() {
    if (!sock) return;
    const old = sock;
    sock = null;
    try {
      old.end(undefined);
    } catch {
      // уже закрыт
    }
  }

  // Одно подключение за раз: пост и переподключение по таймеру могли бы открыть
  // два сокета, и второй выбил бы первый.
  function connect(options) {
    if (!pending) {
      pending = open(options).finally(() => {
        pending = null;
      });
    }
    return pending;
  }

  async function open({ pair = false } = {}) {
    const lib = await load();
    if (!auth) auth = await authState(lib);
    const { state, saveCreds } = auth;
    if (!pair && !state.creds.registered) {
      status = 'unlinked';
      return false;
    }
    drop();
    status = pair ? 'linking' : 'connecting';
    // Версию WhatsApp Web — свежую: со старой WhatsApp не пускает. Не узнали —
    // берём ту, что зашита в библиотеку.
    const latest = lib.fetchLatestBaileysVersion ? await lib.fetchLatestBaileysVersion().catch(() => null) : null;
    const makeSocket = lib.makeWASocket || lib.default;
    const s = makeSocket({
      auth: state,
      logger: SILENT,
      browser: lib.Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      ...(latest && latest.version ? { version: latest.version } : {}),
    });
    sock = s;
    s.ev.on('creds.update', () => saveCreds().catch((err) => fail(new Error(`вход не сохранён: ${err.message}`))));
    let asked = false;
    const askOnce = () => {
      if (asked) return false;
      asked = true;
      return true;
    };
    s.ev.on('connection.update', (update) => {
      if (s !== sock) return; // старый сокет после переподключения
      onUpdate(lib, s, update, pair, askOnce).catch(fail);
    });
    return true;
  }

  async function onUpdate(lib, s, { connection, lastDisconnect, qr }, pair, askOnce) {
    if (qr && pair && askOnce()) {
      const waiter = pairing;
      pairing = null;
      try {
        const value = await s.requestPairingCode(number);
        if (waiter) waiter.resolve(value);
      } catch (err) {
        if (waiter) waiter.reject(err);
      }
      return;
    }
    if (connection === 'open') {
      status = 'open';
      attempt = 0;
      lastError = '';
      settle();
      if (linking) {
        linking = false;
        await notify('✅ WhatsApp привязан: подборки пойдут в канал по расписанию. Проверить сейчас — /whatsapp now');
      }
      return;
    }
    if (connection !== 'close') return;

    sock = null;
    const reason = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
      ? lastDisconnect.error.output.statusCode
      : undefined;
    const R = lib.DisconnectReason;
    if (reason === R.loggedOut) {
      // Отвязали в телефоне. Старый вход больше не пустят, а с ним бот не
      // попросит новый код — стираем.
      status = 'unlinked';
      auth = null;
      jid = '';
      linking = false;
      settle(new Error('WhatsApp не привязан: /whatsapp link'));
      await clearAuth();
      await notify('⚠️ WhatsApp-канал: второй номер отвязан от бота, подборки не выходят. Привязать заново — /whatsapp link');
      return;
    }
    if (reason === R.connectionReplaced) {
      // Тот же вход открыл другой экземпляр бота: при деплое Render пару минут
      // держит старый и новый. Не отбиваем вход обратно, иначе они толкались бы
      // по кругу. Пост сам подключится заново (см. ready).
      status = 'replaced';
      settle(new Error('вход WhatsApp перехватил другой экземпляр бота'));
      return;
    }
    if (!auth.state.creds.registered) {
      // Код не ввели вовремя. Сами не повторяем: каждый повтор — новый код в
      // Telegram, и админ не поймёт, какой вводить.
      status = 'unlinked';
      linking = false;
      settle(new Error('WhatsApp не привязан: код не ввели, /whatsapp link'));
      return;
    }
    // После ввода кода WhatsApp просит переподключиться (restartRequired) —
    // сразу. Остальные обрывы — с нарастающей паузой.
    status = 'connecting';
    if (lastDisconnect && lastDisconnect.error) lastError = lastDisconnect.error.message;
    let ms = 0;
    if (reason !== R.restartRequired) {
      ms = Math.min(RECONNECT_MIN_MS * 2 ** attempt, RECONNECT_MAX_MS);
      attempt += 1;
    }
    later(() => {
      if (!sock) connect().catch(fail);
    }, ms);
  }

  // Сокет, готовый к отправке: подключаемся, если надо, и ждём до минуты.
  async function ready() {
    if (!code) throw new Error('WhatsApp-канал выключен: не задан WA_CHANNEL');
    if (!sock && !(await connect())) throw new Error('WhatsApp не привязан: /whatsapp link');
    if (status === 'open' && sock) return sock;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting = waiting.filter((w) => w !== waiter);
        reject(new Error('WhatsApp не подключился за минуту'));
      }, OPEN_WAIT_MS);
      timer.unref();
      const waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      waiting.push(waiter);
    });
    return sock;
  }

  // Канал узнаём по коду из ссылки один раз. Номер не админ — WhatsApp пост не
  // примет, поэтому говорим об этом прямо.
  async function target(s) {
    if (jid) return jid;
    const meta = await s.newsletterMetadata('invite', code);
    if (!meta || !meta.id) throw new Error('канал по ссылке WA_CHANNEL не найден');
    const role = meta.viewer_metadata && meta.viewer_metadata.role;
    if (role && role !== 'ADMIN' && role !== 'OWNER') {
      throw new Error(`номер ${number} не админ канала — добавьте его в админы канала`);
    }
    jid = meta.id;
    const title = meta.thread_metadata && meta.thread_metadata.name && meta.thread_metadata.name.text;
    name = title || meta.name || '';
    return jid;
  }

  async function post(text) {
    try {
      const s = await ready();
      await s.sendMessage(await target(s), { text });
    } catch (err) {
      lastError = err.message;
      throw err;
    }
  }

  // Новая привязка: код для второго телефона. null — уже привязан.
  async function link() {
    if (!code) throw new Error('не задан WA_CHANNEL');
    if (!number) throw new Error('не задан WA_PHONE');
    if (status === 'open') return null;
    await clearAuth();
    auth = null;
    jid = '';
    drop();
    linking = true;
    const codeReady = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pairing = null;
        reject(new Error('WhatsApp не прислал код — попробуйте ещё раз'));
      }, PAIRING_WAIT_MS);
      timer.unref();
      pairing = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
    });
    await connect({ pair: true });
    return codeReady;
  }

  function start() {
    if (code) connect().catch(fail);
  }

  const info = () => ({ status, name, lastError, phone: number });

  return { enabled: Boolean(code), start, link, post, info };
}

module.exports = { createChannel, inviteCode };

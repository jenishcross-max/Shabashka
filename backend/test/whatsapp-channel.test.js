// Подключение к WhatsApp-каналу (см. src/whatsapp/channel.js). Настоящий
// WhatsApp тесту не нужен и опасен — вместо Baileys здесь поддельный модуль:
// сокет, который сообщает о событиях, когда скажет тест.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { install } = require('./helpers/stub');

const requireSrc = install({});
const { createChannel, inviteCode } = requireSrc('whatsapp/channel.js');

const INVITE = 'https://whatsapp.com/channel/0029VbDkFgd90x2sGL6f6m0p';

function fakeLib() {
  const sockets = [];
  return {
    sockets,
    DisconnectReason: { connectionClosed: 428, timedOut: 408, loggedOut: 401, connectionReplaced: 440, restartRequired: 515 },
    Browsers: { ubuntu: (browser) => ['Ubuntu', browser, '22.04'] },
    makeWASocket(config) {
      const s = {
        config,
        ev: new EventEmitter(),
        sent: [],
        codes: [],
        meta: [],
        role: 'ADMIN',
        ended: false,
        requestPairingCode: async (phone) => {
          s.codes.push(phone);
          return 'ABCD1234';
        },
        newsletterMetadata: async (type, key) => {
          s.meta.push([type, key]);
          return {
            id: '120363@newsletter',
            thread_metadata: { name: { text: 'Жумуш | Работа | Шабашка' } },
            viewer_metadata: { role: s.role },
          };
        },
        sendMessage: async (jid, content) => {
          s.sent.push([jid, content]);
        },
        end: () => {
          s.ended = true;
        },
        emit: (update) => s.ev.emit('connection.update', update),
        close: (statusCode) =>
          s.ev.emit('connection.update', {
            connection: 'close',
            lastDisconnect: { error: { message: `закрыто ${statusCode}`, output: { statusCode } } },
          }),
      };
      sockets.push(s);
      return s;
    },
  };
}

function setup({ registered = false, invite = INVITE } = {}) {
  const lib = fakeLib();
  const creds = { registered };
  const notes = [];
  const timers = [];
  let cleared = 0;
  const channel = createChannel({
    invite,
    phone: '+996 700 123 456',
    notify: async (text) => notes.push(text),
    load: async () => lib,
    authState: async () => ({ state: { creds }, saveCreds: async () => {} }),
    clearAuth: async () => {
      cleared += 1;
      creds.registered = false;
    },
    later: (fn, ms) => timers.push({ fn, ms }),
  });
  return { lib, creds, notes, timers, channel, cleared: () => cleared };
}

// Обработчики событий асинхронные: даём им доработать.
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('номер не привязан — при старте не подключается', async () => {
  const { lib, channel } = setup();
  channel.start();
  await flush();
  assert.equal(lib.sockets.length, 0);
  assert.equal(channel.info().status, 'unlinked');
});

test('привязка кодом: код один на подключение, после ввода — «привязан»', async () => {
  const { lib, creds, notes, timers, channel } = setup();
  const pending = channel.link();
  await flush();
  const [s] = lib.sockets;
  s.emit({ qr: 'qr-1' });
  assert.equal(await pending, 'ABCD1234');
  s.emit({ qr: 'qr-2' });
  await flush();
  assert.deepEqual(s.codes, ['996700123456'], 'номер — только цифры, и код просим один раз');

  // Код ввели: WhatsApp просит переподключиться (515) — сразу, без паузы.
  creds.registered = true;
  s.close(515);
  await flush();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 0);
  timers[0].fn();
  await flush();
  lib.sockets[1].emit({ connection: 'open' });
  await flush();
  assert.equal(channel.info().status, 'open');
  assert.equal(notes.length, 1);
  assert.match(notes[0], /✅ WhatsApp привязан/);
});

test('пост уходит в канал по ссылке; канал узнаём один раз', async () => {
  const { lib, channel } = setup({ registered: true });
  channel.start();
  await flush();
  const first = channel.post('Свежие вакансии');
  await flush();
  const [s] = lib.sockets;
  s.emit({ connection: 'open' });
  await first;
  await channel.post('Ещё подборка');

  assert.deepEqual(s.meta, [['invite', '0029VbDkFgd90x2sGL6f6m0p']]);
  assert.deepEqual(s.sent, [
    ['120363@newsletter', { text: 'Свежие вакансии' }],
    ['120363@newsletter', { text: 'Ещё подборка' }],
  ]);
  assert.equal(channel.info().name, 'Жумуш | Работа | Шабашка');
});

test('номер не админ канала — понятная ошибка, а не тишина', async () => {
  const { lib, channel } = setup({ registered: true });
  channel.start();
  await flush();
  lib.sockets[0].role = 'SUBSCRIBER';
  lib.sockets[0].emit({ connection: 'open' });
  await assert.rejects(channel.post('текст'), /не админ канала/);
  assert.deepEqual(lib.sockets[0].sent, []);
});

test('номер отвязали в телефоне — вход стёрт, админам сказано, повторов нет', async () => {
  const { lib, notes, timers, channel, cleared } = setup({ registered: true });
  channel.start();
  await flush();
  lib.sockets[0].emit({ connection: 'open' });
  lib.sockets[0].close(401);
  await flush();
  assert.equal(cleared(), 1);
  assert.equal(channel.info().status, 'unlinked');
  assert.match(notes.at(-1), /\/whatsapp link/);
  assert.equal(timers.length, 0);
  await assert.rejects(channel.post('текст'), /не привязан/);
});

test('обрыв связи — переподключение с нарастающей паузой', async () => {
  const { lib, timers, channel } = setup({ registered: true });
  channel.start();
  await flush();
  lib.sockets[0].emit({ connection: 'open' });
  lib.sockets[0].close(428);
  await flush();
  assert.equal(timers[0].ms, 5000);
  timers[0].fn();
  await flush();
  lib.sockets[1].close(428);
  await flush();
  assert.equal(timers[1].ms, 10000);
  timers[1].fn();
  await flush();
  lib.sockets[2].emit({ connection: 'open' });
  lib.sockets[2].close(428);
  await flush();
  assert.equal(timers[2].ms, 5000, 'после удачного входа — снова с короткой паузы');
});

test('вход перехватил второй экземпляр (деплой) — сам не отбивает, пост подключится заново', async () => {
  const { lib, timers, channel } = setup({ registered: true });
  channel.start();
  await flush();
  lib.sockets[0].emit({ connection: 'open' });
  lib.sockets[0].close(440);
  await flush();
  assert.equal(timers.length, 0);
  assert.equal(channel.info().status, 'replaced');

  const sending = channel.post('текст');
  await flush();
  assert.equal(lib.sockets.length, 2);
  lib.sockets[1].emit({ connection: 'open' });
  await sending;
  assert.equal(lib.sockets[1].sent.length, 1);
});

test('код не ввели — без повтора: каждый повтор слал бы новый код', async () => {
  const { lib, timers, channel } = setup();
  const pending = channel.link();
  await flush();
  lib.sockets[0].emit({ qr: 'qr-1' });
  await pending;
  lib.sockets[0].close(408);
  await flush();
  assert.equal(timers.length, 0);
  assert.equal(channel.info().status, 'unlinked');
});

test('без WA_CHANNEL канал выключен', async () => {
  const { lib, channel } = setup({ invite: '' });
  assert.equal(channel.enabled, false);
  channel.start();
  await flush();
  assert.equal(lib.sockets.length, 0);
  await assert.rejects(channel.post('текст'), /выключен/);
});

test('код канала — из ссылки или как есть', () => {
  assert.equal(inviteCode(INVITE), '0029VbDkFgd90x2sGL6f6m0p');
  assert.equal(inviteCode(`${INVITE}/`), '0029VbDkFgd90x2sGL6f6m0p');
  assert.equal(inviteCode(' 0029VbDkFgd90x2sGL6f6m0p '), '0029VbDkFgd90x2sGL6f6m0p');
  assert.equal(inviteCode('шабашка'), '');
  assert.equal(inviteCode(undefined), '');
});

// Мост к расширению директа (см. src/routes/dm.js). Снаружи сюда может прийти
// кто угодно, а за мостом — номер МБанка и публикация «оплаченной» рекламы.
// Поэтому без ключа в Render мост выключен целиком, с неверным ключом — закрыт,
// а скриншот чека в несколько мегабайт проходит.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { install, at } = require('./helpers/stub');

const synced = [];
const requireSrc = install({
  [at('dm/index.js')]: {
    sync: async (payload) => {
      synced.push(payload);
      return { replies: ['Здравствуйте!'] };
    },
    peers: async () => ['client'],
    outbox: async () => [],
    sent: async () => {},
  },
  [at('dm/texts.js')]: { mbank: () => ({ number: '0700123456', name: '' }), PRICE: 50 },
});

const router = requireSrc('routes/dm.js');
const app = express();
app.use('/api/dm', router);

let base = '';
let server;
test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/dm`;
});
test.after(() => server.close());

const call = (path, { key, body } = {}) =>
  fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-bridge-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

test('без DM_BRIDGE_KEY мост выключен', async () => {
  delete process.env.DM_BRIDGE_KEY;
  const res = await call('/ping', { key: 'anything' });
  assert.equal(res.status, 503);
});

test('с неверным ключом — закрыто', async () => {
  process.env.DM_BRIDGE_KEY = 'bridge-key-123';
  assert.equal((await call('/ping')).status, 401);
  assert.equal((await call('/ping', { key: 'bridge-key-124' })).status, 401);
  assert.equal((await call('/ping', { key: 'short' })).status, 401);
  assert.equal(synced.length, 0);
});

test('с верным ключом — работает, и скриншот в мегабайты проходит', async () => {
  process.env.DM_BRIDGE_KEY = 'bridge-key-123';
  const ping = await (await call('/ping', { key: 'bridge-key-123' })).json();
  assert.deepEqual(ping, { ok: true, mbank: true, price: 50 });

  const image = `data:image/jpeg;base64,${Buffer.alloc(3 * 1024 * 1024, 7).toString('base64')}`;
  const res = await call('/threads/sync', {
    key: 'bridge-key-123',
    body: { peer: 'client', request: true, messages: [{ key: 'm1', from: 'them', text: '', image }] },
  });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).replies, ['Здравствуйте!']);
  assert.equal(synced[0].request, true);
});

test('тело без ключа даже не разбирается — сразу 401', async () => {
  process.env.DM_BRIDGE_KEY = 'bridge-key-123';
  // Не JSON вовсе: если бы тело разбиралось до ключа, ответом было бы 400.
  const res = await fetch(`${base}/threads/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{не json',
  });
  assert.equal(res.status, 401);
});

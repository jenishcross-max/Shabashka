// Вход WhatsApp-канала в базе (см. src/whatsapp/auth.js): у бесплатного Render
// нет диска, и без этого второй номер пришлось бы привязывать после каждого
// деплоя. Проверяем на PGlite и настоящем модуле Baileys: ключи — это Buffer, и
// важно, что из базы возвращается именно Buffer, а не похожий на него объект.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const auth = requireSrc('whatsapp/auth.js');

let lib;
test.before(async () => {
  lib = await import('@whiskeysockets/baileys');
});

test('новый вход: ещё не привязан; сохранённый возвращается теми же ключами', async () => {
  const first = await auth.useDbAuthState(lib);
  assert.equal(first.state.creds.registered, false);
  await first.saveCreds();

  const again = await auth.useDbAuthState(lib);
  const key = again.state.creds.noiseKey.private;
  assert.ok(Buffer.isBuffer(key), 'ключ из базы — настоящий Buffer');
  assert.deepEqual(key, first.state.creds.noiseKey.private);
  assert.equal(again.state.creds.registrationId, first.state.creds.registrationId);
});

test('ключи шифрования: запись, чтение, удаление через null', async () => {
  const { state } = await auth.useDbAuthState(lib);
  const secret = Buffer.from([1, 2, 3, 250]);
  await state.keys.set({ 'pre-key': { 1: { public: secret, private: secret }, 2: { public: secret, private: secret } } });

  const got = await state.keys.get('pre-key', ['1', '2', '3']);
  assert.ok(Buffer.isBuffer(got['1'].public));
  assert.deepEqual(got['1'].public, secret);
  assert.equal(got['3'], null, 'нет ключа — null, как у файлового входа Baileys');

  await state.keys.set({ 'pre-key': { 1: null } });
  const after = await state.keys.get('pre-key', ['1', '2']);
  assert.equal(after['1'], null);
  assert.ok(after['2']);
});

test('ключ синхронизации приходит объектом proto, как его ждёт Baileys', async () => {
  const { state } = await auth.useDbAuthState(lib);
  const keyData = Buffer.from('ключ синхронизации');
  await state.keys.set({ 'app-state-sync-key': { AAA: { keyData, timestamp: 1 } } });
  const { AAA } = await state.keys.get('app-state-sync-key', ['AAA']);
  assert.ok(AAA instanceof lib.proto.Message.AppStateSyncKeyData);
  assert.deepEqual(Buffer.from(AAA.keyData), keyData);
});

test('clear стирает вход целиком', async () => {
  await auth.clear();
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM wa_auth');
  assert.equal(rows[0].n, 0);
  const fresh = await auth.useDbAuthState(lib);
  assert.equal(fresh.state.creds.registered, false);
});

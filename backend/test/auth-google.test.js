// Вход через Google (POST /api/auth/google): сайт присылает токен от кнопки
// Google, бэкенд проверяет его у Google и входит в аккаунт с этой почтой или
// заводит новый. Google здесь подменён — настоящая только база (PGlite).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

process.env.GOOGLE_CLIENT_ID = 'shabashka.apps.googleusercontent.com';

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const app = express();
app.use(express.json());
app.use('/api/auth', requireSrc('routes/auth.js'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

// Ответы tokeninfo по токену; остальные запросы — настоящие, к нашему серверу.
const google = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const href = String(url);
  if (!href.startsWith('https://oauth2.googleapis.com/tokeninfo')) return realFetch(url, opts);
  const info = google.get(new URL(href).searchParams.get('id_token'));
  return info ? new Response(JSON.stringify(info)) : new Response('{"error":"invalid_token"}', { status: 400 });
};

const profile = (email, extra = {}) => ({
  aud: process.env.GOOGLE_CLIENT_ID,
  iss: 'https://accounts.google.com',
  email,
  email_verified: 'true',
  name: 'Айбек Токтогулов',
  ...extra,
});

let base = '';
let server;
test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/auth`;
});
test.after(() => {
  server.close();
  globalThis.fetch = realFetch;
});

const signIn = (credential) =>
  realFetch(`${base}/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });

test('сайт узнаёт ключ клиента у бэкенда', async () => {
  const res = await realFetch(`${base}/google/config`);
  assert.deepEqual(await res.json(), { clientId: 'shabashka.apps.googleusercontent.com' });
});

test('новая почта — новый аккаунт, сразу подтверждённый; второй вход — в него же', async () => {
  google.set('t1', profile('New.User@Gmail.com'));
  const res = await signIn('t1');
  assert.equal(res.status, 200);
  const { token, user } = await res.json();
  assert.ok(token);
  assert.equal(user.email, 'new.user@gmail.com');
  assert.equal(user.name, 'Айбек Токтогулов');
  assert.equal(user.emailVerified, true, 'почту подтвердил Google — письмо не нужно');
  assert.equal(user.phone, '');

  const again = await (await signIn('t1')).json();
  assert.equal(again.user.id, user.id, 'второй аккаунт не заводим');
});

test('аккаунт с этой почтой уже есть — входим в него и считаем почту подтверждённой', async () => {
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, verify_token)
     VALUES ('Старый', 'old@gmail.com', '+996700111222', 'x', false, 'abc') RETURNING id`
  );
  google.set('t2', profile('old@gmail.com'));
  const { user } = await (await signIn('t2')).json();
  assert.equal(user.id, rows[0].id);
  assert.equal(user.name, 'Старый', 'имя своё, не из Google');
  assert.equal(user.phone, '+996700111222');
  assert.equal(user.emailVerified, true);
  const stored = (await db.query('SELECT email_verified, verify_token FROM users WHERE id = $1', [user.id])).rows[0];
  assert.deepEqual(stored, { email_verified: true, verify_token: null });
});

test('чужой клиент, неподтверждённая почта, подделка и блокировка — не входим', async () => {
  google.set('foreign', profile('a@gmail.com', { aud: 'someone-else.apps.googleusercontent.com' }));
  google.set('unverified', profile('b@gmail.com', { email_verified: 'false' }));
  google.set('issuer', profile('c@gmail.com', { iss: 'evil.example.com' }));
  for (const credential of ['foreign', 'unverified', 'issuer', 'forged']) {
    assert.equal((await signIn(credential)).status, 401, credential);
  }
  assert.equal((await signIn('')).status, 400);
  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM users WHERE email IN ('a@gmail.com', 'b@gmail.com', 'c@gmail.com')");
  assert.equal(rows[0].n, 0, 'аккаунтов по чужим токенам не заводим');

  await db.query(
    "INSERT INTO users (name, email, phone, password_hash, is_blocked) VALUES ('Спамер', 'spam@gmail.com', '', 'x', 1)"
  );
  google.set('blocked', profile('spam@gmail.com'));
  assert.equal((await signIn('blocked')).status, 403);
});

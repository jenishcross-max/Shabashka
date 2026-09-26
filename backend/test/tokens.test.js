// Продление токенов Meta (см. src/social/tokens.js). Токен живёт шестьдесят
// дней, и без продления рекламный канал в Threads однажды встал бы молча.
// Проверяем: продлённый токен хранится в базе и переживает перезапуск; новый
// токен, вписанный в Render руками, главнее продлённого; сам токен не
// попадает ни в лог, ни в сообщение админу.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { install, at } = require('./helpers/stub');
const { fakeDb } = require('./helpers/fakeDb');

process.env.THREADS_ACCESS_TOKEN = 'старый-токен-threads';
process.env.INSTAGRAM_ACCESS_TOKEN = '';

const db = fakeDb();
install({ [at('db/index.js')]: db });
const TOKENS = path.resolve(at('social/tokens.js'));
const fresh = () => {
  delete require.cache[TOKENS];
  return require(TOKENS);
};

let answer = null;
const asked = [];
global.fetch = async (url) => {
  asked.push(String(url));
  return answer();
};
const ok = (token) => () => ({ ok: true, status: 200, json: async () => ({ access_token: token, expires_in: 5184000 }) });

const logged = [];
const realLog = console.log;
console.log = (...args) => {
  logged.push(args.join(' '));
};

test('без продления в ход идёт токен из окружения', () => {
  const tokens = fresh();
  assert.equal(tokens.get('threads'), 'старый-токен-threads');
});

test('продление получает новый токен, кладёт его в базу и дальше ходит с ним', async () => {
  const tokens = fresh();
  answer = ok('новый-токен-threads');
  const result = await tokens.refresh('threads');
  assert.equal(result.refreshed, true);
  assert.match(asked.at(-1), /graph\.threads\.net\/refresh_access_token/);
  assert.match(asked.at(-1), /grant_type=th_refresh_token/);
  assert.equal(tokens.get('threads'), 'новый-токен-threads');
  assert.ok(tokens.daysLeft('threads') >= 59, 'срок — шестьдесят дней');
  assert.ok(db.settings.get('token:threads'), 'записан в базу');
});

test('после перезапуска продлённый токен читается из базы', async () => {
  const tokens = fresh();
  await tokens.load();
  assert.equal(tokens.get('threads'), 'новый-токен-threads');
});

test('раньше недели второй раз не продлевает — лишний запрос к Meta незачем', async () => {
  const tokens = fresh();
  await tokens.load();
  const before = asked.length;
  const result = await tokens.refresh('threads');
  assert.equal(result.refreshed, false);
  assert.equal(asked.length, before);
});

test('новый токен в окружении главнее продлённого из базы', async () => {
  process.env.THREADS_ACCESS_TOKEN = 'токен-вписан-руками';
  const tokens = fresh();
  await tokens.load();
  assert.equal(tokens.get('threads'), 'токен-вписан-руками');
});

test('провал продления — сообщение админу, но без самого токена', async () => {
  const tokens = fresh();
  answer = () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: 'Session has expired', code: 190 } }),
  });
  const messages = [];
  await tokens.start(async (text) => messages.push(text));
  // Первая проверка идёт через минуту после старта — зовём её напрямую.
  await assert.rejects(() => tokens.refresh('threads', { force: true }), /Session has expired/);
  for (const text of [...messages, ...logged]) {
    assert.ok(!text.includes('токен-вписан-руками'), `токен утёк: ${text}`);
  }
});

test('Instagram через Facebook Login так не продлевается — его не трогаем', async () => {
  process.env.INSTAGRAM_ACCESS_TOKEN = 'токен-инстаграма';
  process.env.INSTAGRAM_GRAPH_HOST = 'graph.facebook.com';
  const tokens = fresh();
  const before = asked.length;
  const result = await tokens.refresh('instagram', { force: true });
  assert.equal(result.refreshed, false);
  assert.equal(asked.length, before);
  console.log = realLog;
});

// IndexNow для Яндекса (см. src/indexNow.js): новые вакансии и заказы сайт сам
// сообщает Яндексу. 24 ноября 2026 из Яндекса за месяц не было ни одного визита
// при 520 из Google. Настоящий SQL — PGlite в памяти, Яндекс — подменный fetch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const indexNow = requireSrc('indexNow.js');

const SITE = 'https://xn--80aaac0cyed.com';
let since;

test.before(async () => {
  await db.query('ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS is_example BOOLEAN NOT NULL DEFAULT false');
  await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_example BOOLEAN NOT NULL DEFAULT false');
  await db.query("INSERT INTO users (name, email, phone, password_hash) VALUES ('Админ', 'a@test', '0700000000', 'x')");
  const vacancy = (title, extra = {}) =>
    db.query(
      `INSERT INTO vacancies (user_id, title, description, category, employment_type, city, status, is_example, created_at)
       VALUES (1, $1, 'Описание', 'Общепит', 'full_time', 'Бишкек', $2, $3, $4)`,
      [title, extra.status || 'open', Boolean(extra.example), extra.at || new Date()]
    );
  await vacancy('Старая', { at: new Date(Date.now() - 3600e3) });
  since = new Date(Date.now() - 60e3);
  await vacancy('Официант');
  await vacancy('Закрытая', { status: 'closed' });
  await vacancy('Пример', { example: true });
  await db.query(
    `INSERT INTO orders (user_id, title, description, category, city) VALUES (1, 'Грузчики', 'Описание', 'Грузчики', 'Бишкек')`
  );
});

// Подменный Яндекс: запоминает запросы, отвечает заданным кодом.
function yandex(status = 200) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (status instanceof Error) throw status;
    return { status };
  };
  return { calls, fetchImpl };
}

test('новые открытые вакансии и заказы — без старых, закрытых и примеров', async () => {
  const urls = await indexNow.freshUrls(SITE, since);
  assert.deepEqual(urls, [`${SITE}/vacancies/2`, `${SITE}/orders/1`]);
});

test('Яндексу — host, ключ, где лежит ключ, и адреса', async () => {
  const { calls, fetchImpl } = yandex(200);
  const next = await indexNow.tick(SITE, since, fetchImpl);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://yandex.com/indexnow');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(calls[0].body, {
    host: 'xn--80aaac0cyed.com',
    key: indexNow.KEY,
    keyLocation: `${SITE}/${indexNow.KEY}.txt`,
    urlList: [`${SITE}/vacancies/2`, `${SITE}/orders/1`],
  });
  assert.ok(next > since, 'следующий проход — с этого момента');
});

test('нового нет — Яндексу не пишем', async () => {
  const { calls, fetchImpl } = yandex(200);
  const next = await indexNow.tick(SITE, new Date(Date.now() + 60e3), fetchImpl);
  assert.equal(calls.length, 0);
  assert.ok(next instanceof Date);
});

test('Яндекс не ответил или занят — адреса отправим следующим проходом', async () => {
  await assert.rejects(indexNow.tick(SITE, since, yandex(new Error('timeout')).fetchImpl));
  await assert.rejects(indexNow.tick(SITE, since, yandex(503).fetchImpl));
  await assert.rejects(indexNow.tick(SITE, since, yandex(429).fetchImpl));
});

test('Яндекс отказал (ключ, адреса) — не повторяем без конца', async () => {
  const next = await indexNow.tick(SITE, since, yandex(422).fetchImpl);
  assert.ok(next > since);
});

test('ключ лежит на сайте — без него Яндекс адреса не примет', () => {
  assert.match(indexNow.KEY, /^[0-9a-f]{32}$/);
  const file = path.resolve(__dirname, '..', '..', 'frontend', 'public', `${indexNow.KEY}.txt`);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), indexNow.KEY);
});

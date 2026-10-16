// Раздел «Объявления» через HTTP (src/routes/ads.js) — так, как его увидят сайт и
// Android-приложение: настоящая авторизация, настоящий SQL (PGlite в памяти).
// Вместо Supabase Storage — заглушка, которая помнит, что у неё просили; вместо
// Telegram — копилка уведомлений; лимиты по адресу выключены: весь файл ходит с
// одного 127.0.0.1 и упёрся бы в них раньше, чем в проверки.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const notified = [];
const removedPhotos = [];
const storage = {
  configured: true,
  newPath: (userId) => `u${userId}/123e4567-e89b-42d3-a456-${String(Date.now() % 1e12).padStart(12, '0')}.jpg`,
  publicUrl: (path) => `https://cdn.test/${path}`,
  signUpload: async (path) => `https://upload.test/${path}?token=t`,
  remove: async (paths) => {
    removedPhotos.push(...paths);
  },
};
const pass = (_req, _res, next) => next();
const requireSrc = install({
  [at('db/index.js')]: db,
  [at('photoStorage.js')]: storage,
  [at('rateLimit.js')]: new Proxy({}, { get: () => pass }),
  [at('telegram/notify.js')]: {
    ADMIN_IDS: new Set(),
    isAllowed: () => false,
    notifyAdmins: async (text) => {
      notified.push(text);
    },
  },
});

const { signToken } = requireSrc('middleware/auth.js');
const app = express();
app.use(express.json());
app.use('/api/ads', requireSrc('routes/ads.js'));
app.use('/api/conversations', requireSrc('routes/conversations.js'));
app.use('/api/admin', requireSrc('routes/admin.js'));
app.use('/api/home', requireSrc('routes/home.js'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

let base = '';
let server;
test.before(async () => {
  // Главная читает is_example у заказов и вакансий, а эту колонку добавляет не
  // schema.sql, а db/index.js при старте — повторяем его здесь.
  await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_example BOOLEAN NOT NULL DEFAULT false');
  await db.query('ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS is_example BOOLEAN NOT NULL DEFAULT false');
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

let seq = 0;
async function user(name, { verified = true, role = 'customer' } = {}) {
  seq += 1;
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
     VALUES ($1, $2, $3, 'x', $4, $5) RETURNING *`,
    [name, `ads${seq}@test.kg`, `+99670000100${seq}`, verified, role]
  );
  return rows[0];
}

async function call(path, { as, method, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${signToken(as)}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

const AD = {
  kind: 'rent_out',
  category: 'rest',
  title: 'Номер в пансионате',
  description: 'На двоих, у самого озера',
  price: 2500,
  price_unit: 'day',
  city: 'Чолпон-Ата',
  whatsapp_phone: '0700 123 456',
};
const photoOf = (owner, n) => `u${owner.id}/123e4567-e89b-42d3-a456-00000000000${n}.jpg`;

async function newAd(owner, extra = {}) {
  const res = await call('/ads', { as: owner, body: { ...AD, ...extra } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.ad;
}

test('гость видит ленту и объявление, но подать не может', async () => {
  const owner = await user('Айгуль');
  const ad = await newAd(owner);
  assert.equal(ad.whatsapp_phone, '+996700123456');
  assert.equal(ad.owner_name, 'Айгуль');
  assert.ok((await call('/ads')).body.ads.some((a) => a.id === ad.id));
  const view = await call(`/ads/${ad.id}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.ad.title, AD.title);
  assert.equal((await call('/ads', { body: AD })).status, 401);
  assert.equal((await call('/ads/999999')).status, 404);
  assert.equal((await call('/ads/abc')).status, 404);
});

test('лента: фильтры из адреса, мусор в них не ломает запрос', async () => {
  const owner = await user('Бакыт');
  const marker = `лента${Date.now()}`;
  const car = await newAd(owner, { kind: 'sell', category: 'transport', title: `Машина ${marker}`, price: 900000, price_unit: 'total' });
  await newAd(owner, { title: `Комната ${marker}` });
  const only = async (qs) => (await call(`/ads?q=${encodeURIComponent(marker)}&${qs}`)).body;
  assert.deepEqual((await only('kind=sell')).ads.map((a) => a.id), [car.id]);
  assert.deepEqual((await only('priceMin=100%20000')).ads.map((a) => a.id), [car.id]);
  assert.equal((await only('kind=swap&category=cars&priceMin=abc&sort=hack&page=-5')).total, 2);
  const paged = await only('limit=1&page=2');
  assert.equal(paged.ads.length, 1);
  assert.equal(paged.pages, 2);
});

test('подача: неполное и с чужими фото — 400, свои фото приходят со ссылками', async () => {
  const owner = await user('Айгуль');
  assert.equal((await call('/ads', { as: owner, body: { ...AD, title: '' } })).status, 400);
  const stranger = await user('Чужой');
  assert.equal((await call('/ads', { as: owner, body: { ...AD, photos: [photoOf(stranger, 1)] } })).status, 400);
  const ad = await newAd(owner, { photos: [photoOf(owner, 1), photoOf(owner, 2)] });
  assert.deepEqual(ad.photos, [
    { path: photoOf(owner, 1), url: `https://cdn.test/${photoOf(owner, 1)}` },
    { path: photoOf(owner, 2), url: `https://cdn.test/${photoOf(owner, 2)}` },
  ]);
});

test('правка: чужому — 403, автору — можно; убранные фото удаляются из хранилища', async () => {
  const owner = await user('Айгуль');
  const ad = await newAd(owner, { photos: [photoOf(owner, 1), photoOf(owner, 2)] });
  const stranger = await user('Чужой');
  assert.equal((await call(`/ads/${ad.id}`, { as: stranger, method: 'PATCH', body: AD })).status, 403);

  removedPhotos.length = 0;
  const edited = await call(`/ads/${ad.id}`, {
    as: owner,
    method: 'PATCH',
    body: { ...AD, title: 'Номер с видом на озеро', photos: [photoOf(owner, 2)] },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.ad.title, 'Номер с видом на озеро');
  assert.deepEqual(removedPhotos, [photoOf(owner, 1)]);
});

test('закрыть, открыть снова, поднять — только автор и только раз в сутки', async () => {
  const owner = await user('Айгуль');
  const marker = `шаги${Date.now()}`;
  const ad = await newAd(owner, { title: `Квартира ${marker}` });
  const stranger = await user('Чужой');
  assert.equal((await call(`/ads/${ad.id}/close`, { as: stranger, method: 'POST' })).status, 403);

  assert.equal((await call(`/ads/${ad.id}/close`, { as: owner, method: 'POST' })).body.ad.status, 'closed');
  assert.equal((await call(`/ads/${ad.id}/close`, { as: owner, method: 'POST' })).status, 409);
  assert.equal((await call(`/ads?q=${encodeURIComponent(marker)}`)).body.total, 0, 'закрытого нет в ленте');
  assert.equal((await call(`/ads/${ad.id}`)).body.ad.status, 'closed', 'но по ссылке видно');
  assert.equal((await call(`/ads/${ad.id}/bump`, { as: owner, method: 'POST' })).status, 409);

  assert.equal((await call(`/ads/${ad.id}/reopen`, { as: owner, method: 'POST' })).body.ad.status, 'open');
  const early = await call(`/ads/${ad.id}/bump`, { as: owner, method: 'POST' });
  assert.equal(early.status, 429, 'только что поданное поднимать рано');
  assert.ok(early.body.nextBumpAt);
});

test('удаление: чужому — 403, автору — 204 вместе с фото', async () => {
  const owner = await user('Айгуль');
  const ad = await newAd(owner, { photos: [photoOf(owner, 3)] });
  assert.equal((await call(`/ads/${ad.id}`, { as: await user('Чужой'), method: 'DELETE' })).status, 403);
  removedPhotos.length = 0;
  assert.equal((await call(`/ads/${ad.id}`, { as: owner, method: 'DELETE' })).status, 204);
  assert.deepEqual(removedPhotos, [photoOf(owner, 3)]);
  assert.equal((await call(`/ads/${ad.id}`)).status, 404);
});

test('мои и пакет для избранного', async () => {
  const owner = await user('Айгуль');
  const a = await newAd(owner);
  const b = await newAd(owner);
  await call(`/ads/${b.id}/close`, { as: owner, method: 'POST' });
  assert.equal((await call('/ads/mine')).status, 401);
  assert.deepEqual((await call('/ads/mine', { as: owner })).body.ads.map((x) => x.id).sort(), [a.id, b.id].sort());
  assert.deepEqual((await call(`/ads/batch?ids=${a.id},${b.id},abc`)).body.ads.map((x) => x.id).sort(), [a.id, b.id].sort());
});

test('ссылка на загрузку фото: только вошедшим, путь — в папке автора', async () => {
  const owner = await user('Айгуль');
  assert.equal((await call('/ads/photos', { method: 'POST' })).status, 401);
  const res = await call('/ads/photos', { as: owner, method: 'POST' });
  assert.equal(res.status, 201);
  assert.match(res.body.path, new RegExp(`^u${owner.id}/`));
  assert.equal(res.body.upload_url, `https://upload.test/${res.body.path}?token=t`);
  assert.equal(res.body.url, `https://cdn.test/${res.body.path}`);

  storage.configured = false;
  try {
    assert.equal((await call('/ads/photos', { as: owner, method: 'POST' })).status, 503);
  } finally {
    storage.configured = true;
  }
});

test('жалоба уходит админу; «скрыть» снимает объявление, вернуть его правкой нельзя', async () => {
  const owner = await user('Айгуль');
  const marker = `жалоба${Date.now()}`;
  const ad = await newAd(owner, { title: `Подозрительно дёшево ${marker}` });
  assert.equal((await call(`/ads/${ad.id}/report`, { body: { reason: ' ' } })).status, 400);
  assert.equal((await call('/ads/999999/report', { body: { reason: 'обман' } })).status, 404);
  assert.equal((await call(`/ads/${ad.id}/report`, { body: { reason: 'Просят предоплату' } })).status, 201);
  assert.ok(notified.some((t) => t.includes('Объявление') && t.includes(marker)));

  const admin = await user('Админ', { role: 'admin' });
  const { reports } = (await call('/admin/reports', { as: admin })).body;
  const report = reports.find((r) => r.listing_type === 'ad' && r.listing_id === ad.id);
  assert.equal(report.listing_title, ad.title);
  assert.equal(report.listing_alive, true);
  assert.equal((await call(`/admin/reports/${report.id}`, { as: admin, method: 'PATCH', body: { action: 'hide' } })).status, 200);

  assert.equal((await call(`/ads/${ad.id}`)).status, 404, 'гостю снятого не видно');
  assert.equal((await call(`/ads/${ad.id}`, { as: owner })).body.ad.status, 'removed', 'автору видно, что сняли');
  assert.equal((await call(`/ads?q=${encodeURIComponent(marker)}`)).body.total, 0);
  assert.equal((await call(`/ads/${ad.id}`, { as: owner, method: 'PATCH', body: AD })).status, 409);
  assert.equal((await call(`/ads/${ad.id}/reopen`, { as: owner, method: 'POST' })).status, 409);
});

test('переписка по объявлению: написать автору можно, себе и по закрытому — нет', async () => {
  const owner = await user('Айгуль');
  const buyer = await user('Бакыт');
  const ad = await newAd(owner);

  const started = await call('/conversations', { as: buyer, body: { adId: ad.id, message: 'Свободно на выходные?' } });
  assert.equal(started.status, 201);
  assert.equal(started.body.conversation.listing_type, 'ad');
  assert.equal(started.body.conversation.listing_title, AD.title);
  assert.equal(started.body.conversation.other_name, 'Айгуль');

  const inbox = (await call('/conversations', { as: owner })).body.conversations;
  assert.ok(inbox.some((c) => c.listing_type === 'ad' && c.listing_title === AD.title));

  assert.equal((await call('/conversations', { as: owner, body: { adId: ad.id, message: 'Привет' } })).status, 400);
  await call(`/ads/${ad.id}/close`, { as: owner, method: 'POST' });
  const closed = await call('/conversations', { as: await user('Третий'), body: { adId: ad.id, message: 'Ещё актуально?' } });
  assert.equal(closed.status, 400);
  assert.equal((await call('/conversations', { as: buyer, body: { adId: 999999, message: 'Есть?' } })).status, 404);
  assert.equal((await call('/conversations', { as: buyer, body: { adId: ad.id, orderId: 1, message: 'Есть?' } })).status, 400);
});

test('второе объявление без подтверждённой почты — нельзя', async () => {
  const fresh = await user('Новичок', { verified: false });
  await newAd(fresh);
  const second = await call('/ads', { as: fresh, body: AD });
  assert.equal(second.status, 403);
  assert.equal(second.body.code, 'EMAIL_NOT_VERIFIED');
});

test('просмотр автора не считается, чужой — считается', async () => {
  const owner = await user('Айгуль');
  const ad = await newAd(owner);
  await call(`/ads/${ad.id}`, { as: owner });
  await call(`/ads/${ad.id}`);
  assert.equal((await call(`/ads/${ad.id}`, { as: owner })).body.ad.views, 1);
});

test('главная отдаёт свежие объявления со ссылками на фото', async () => {
  const owner = await user('Айгуль');
  const ad = await newAd(owner, { photos: [photoOf(owner, 4)] });
  const home = await call('/home');
  const { ads } = home.body;
  assert.ok(Array.isArray(ads) && ads.length <= 4, JSON.stringify(home.body));
  // Самое свежее: подача сбрасывает кэш главной, и оно сразу первое.
  assert.equal(ads[0].id, ad.id);
  assert.equal(ads[0].photos[0].url, `https://cdn.test/${photoOf(owner, 4)}`);
});

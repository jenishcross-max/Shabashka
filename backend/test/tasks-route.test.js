// Биржа услуг через HTTP (src/routes/tasks.js) — так же, как её увидят сайт и
// Android-приложение: настоящая авторизация, настоящий SQL (PGlite в памяти),
// вместо Telegram — копилка уведомлений.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const notified = [];
const requireSrc = install({
  [at('db/index.js')]: db,
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
app.use('/api/tasks', requireSrc('routes/tasks.js'));
app.use('/api/conversations', requireSrc('routes/conversations.js'));
app.use('/api/admin', requireSrc('routes/admin.js'));
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

let base = '';
let server;
test.before(async () => {
  await db.query("INSERT INTO categories (name) VALUES ('Уборка')");
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
    [name, `r${seq}@test.kg`, `+99670000000${seq}`, verified, role]
  );
  return rows[0];
}

async function call(path, { as, method, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${signToken(as)}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

const TASK = {
  title: 'Убраться в квартире',
  description: 'Две комнаты',
  category: 'Уборка',
  city: 'Бишкек',
  work_format: 'offline',
  budget: 3000,
};
const OFFER = { price: 2500, term: 'за день', comment: 'Свой пылесос' };

test('гость видит задачу и ленту, но откликнуться не может', async () => {
  const owner = await user('Айгуль');
  const { body } = await call('/tasks', { as: owner, body: TASK });
  const id = body.task.id;
  assert.equal((await call('/tasks')).body.tasks.some((t) => t.id === id), true);
  const view = await call(`/tasks/${id}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.my_offer, null);
  assert.equal(view.body.task.whatsapp_phone, undefined, 'телефона в задаче нет');
  assert.equal((await call(`/tasks/${id}/offers`, { body: OFFER })).status, 401);
  assert.equal((await call('/tasks/999999')).status, 404);
});

test('автор не откликается на свою задачу, неполный отклик — 400', async () => {
  const owner = await user('Айгуль');
  const id = (await call('/tasks', { as: owner, body: TASK })).body.task.id;
  assert.equal((await call(`/tasks/${id}/offers`, { as: owner, body: OFFER })).status, 400);
  const bad = await call(`/tasks/${id}/offers`, { as: await user('Бакыт'), body: { price: 'дёшево' } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /цену/);
});

test('полный путь: отклики → выбор → переписка → выполнено', async () => {
  const owner = await user('Айгуль');
  const a = await user('Азамат');
  const b = await user('Бакыт');
  const id = (await call('/tasks', { as: owner, body: TASK })).body.task.id;

  assert.equal((await call(`/tasks/${id}/offers`, { as: a, body: OFFER })).status, 201);
  assert.equal((await call(`/tasks/${id}/offers`, { as: b, body: { ...OFFER, price: 2000 } })).status, 201);

  const asB = await call(`/tasks/${id}`, { as: b });
  assert.equal(asB.body.my_offer.state, 'waiting');
  assert.equal(asB.body.task.offers_count, 2);
  assert.equal((await call(`/tasks/${id}/offers`, { as: b })).status, 403, 'чужие отклики не видны');

  assert.equal((await call('/conversations/unread-count', { as: owner })).body.offers, 2);
  const offers = (await call(`/tasks/${id}/offers`, { as: owner })).body.offers;
  assert.equal(offers.length, 2);
  assert.equal((await call('/conversations/unread-count', { as: owner })).body.offers, 0);

  const offerA = offers.find((o) => o.user_id === a.id);
  const chosen = await call(`/tasks/${id}/offers/${offerA.id}/accept`, { as: owner, body: {} });
  assert.equal(chosen.status, 200);
  assert.equal(chosen.body.task.status, 'assigned');

  assert.equal((await call('/conversations/unread-count', { as: a })).body.count, 1);
  const chat = await call(`/conversations/${chosen.body.conversation_id}`, { as: a });
  assert.match(chat.body.messages[0].body, /Выбираю вас/);
  assert.equal(chat.body.conversation.listing_title, TASK.title);
  assert.equal(chat.body.conversation.other_phone, owner.phone, 'телефон открылся выбранному');
  assert.equal((await call(`/tasks/${id}`, { as: a })).body.conversation_id, chosen.body.conversation_id);
  assert.equal((await call(`/tasks/${id}`, { as: b })).body.conversation_id, null);

  const myB = (await call('/tasks/my-offers', { as: b })).body.offers;
  assert.equal(myB[0].state, 'other');
  const late = await call(`/tasks/${id}/offers`, { as: await user('Кайрат'), body: OFFER });
  assert.equal(late.status, 409);
  assert.match(late.body.error, /уже выбран/);
  assert.equal((await call(`/tasks/${id}/offers/withdraw`, { as: b, body: {} })).status, 409);
  const offerB = offers.find((o) => o.user_id === b.id);
  assert.equal((await call(`/tasks/${id}/offers/${offerB.id}/accept`, { as: owner, body: {} })).status, 409);

  assert.equal((await call(`/tasks/${id}/done`, { as: owner, body: {} })).body.task.status, 'done');
  assert.equal((await call('/tasks/my-offers', { as: a })).body.offers[0].state, 'done');
});

test('отмена выбора возвращает задачу в ленту', async () => {
  const owner = await user('Айгуль');
  const a = await user('Азамат');
  const id = (await call('/tasks', { as: owner, body: TASK })).body.task.id;
  await call(`/tasks/${id}/offers`, { as: a, body: OFFER });
  const [offer] = (await call(`/tasks/${id}/offers`, { as: owner })).body.offers;
  await call(`/tasks/${id}/offers/${offer.id}/accept`, { as: owner, body: {} });

  const chatId = (await call(`/tasks/${id}`, { as: owner })).body.conversation_id;
  assert.ok(chatId);

  assert.equal((await call(`/tasks/${id}/unassign`, { as: owner, body: {} })).body.task.status, 'open');
  assert.equal((await call(`/tasks/${id}`, { as: a })).body.my_offer.state, 'dropped');
  assert.equal((await call(`/tasks/${id}/offers`, { as: a, body: OFFER })).status, 403);

  // Переписка с бывшим исполнителем остаётся историей: телефоны скрыты, писать нельзя.
  const chat = await call(`/conversations/${chatId}`, { as: a });
  assert.equal(chat.status, 200);
  assert.equal(chat.body.conversation.other_phone, null);
  assert.equal(chat.body.conversation.chat_closed, true);
  assert.equal((await call(`/conversations/${chatId}`, { as: owner })).body.conversation.other_phone, null);
  const reply = await call(`/conversations/${chatId}/messages`, { as: a, body: { body: 'Я ещё могу!' } });
  assert.equal(reply.status, 403);
  const listed = (await call('/conversations', { as: a })).body.conversations.find((c) => c.id === chatId);
  assert.equal(listed.chat_closed, true);
});

test('чужую задачу не отменить и не править; своя правится', async () => {
  const owner = await user('Айгуль');
  const stranger = await user('Чужой');
  const id = (await call('/tasks', { as: owner, body: TASK })).body.task.id;
  assert.equal((await call(`/tasks/${id}/cancel`, { as: stranger, body: {} })).status, 403);
  assert.equal((await call(`/tasks/${id}`, { as: stranger, method: 'PATCH', body: { title: 'x' } })).status, 403);
  const edited = await call(`/tasks/${id}`, { as: owner, method: 'PATCH', body: { budget: '' } });
  assert.equal(edited.body.task.budget, null);
});

test('жалобы: на задачу — все, на отклик — только автор задачи; админ снимает отклик', async () => {
  const owner = await user('Айгуль');
  const a = await user('Азамат');
  const admin = await user('Админ', { role: 'admin' });
  const id = (await call('/tasks', { as: owner, body: TASK })).body.task.id;
  await call(`/tasks/${id}/offers`, { as: a, body: OFFER });
  const [offer] = (await call(`/tasks/${id}/offers`, { as: owner })).body.offers;
  await call(`/tasks/${id}/offers/${offer.id}/accept`, { as: owner, body: {} });

  assert.equal((await call(`/tasks/${id}/report`, { body: { reason: 'Спам' } })).status, 201);
  assert.equal((await call(`/tasks/${id}/offers/${offer.id}/report`, { as: a, body: { reason: 'x' } })).status, 403);
  const report = await call(`/tasks/${id}/offers/${offer.id}/report`, {
    as: owner,
    body: { reason: 'Просит предоплату' },
  });
  assert.equal(report.status, 201);
  assert.ok(notified.some((t) => /Отклик на бирже/.test(t) && /Просит предоплату/.test(t)));

  const { reports } = (await call('/admin/reports', { as: admin })).body;
  const offerReport = reports.find((r) => r.listing_type === 'offer' && r.listing_id === offer.id);
  assert.equal(offerReport.offer_task_id, id);
  assert.equal(offerReport.listing_alive, true);
  await call(`/admin/reports/${offerReport.id}`, { as: admin, method: 'PATCH', body: { action: 'hide' } });
  assert.equal((await call(`/tasks/${id}`)).body.task.status, 'open', 'выбранного сняли — задача снова открыта');

  const taskReport = reports.find((r) => r.listing_type === 'task' && r.listing_id === id);
  await call(`/admin/reports/${taskReport.id}`, { as: admin, method: 'PATCH', body: { action: 'hide' } });
  assert.equal((await call(`/tasks/${id}`)).body.task.status, 'cancelled');
});

test('вторую задачу без подтверждённой почты не разместить', async () => {
  const newbie = await user('Новичок', { verified: false });
  assert.equal((await call('/tasks', { as: newbie, body: TASK })).status, 201);
  const second = await call('/tasks', { as: newbie, body: TASK });
  assert.equal(second.status, 403);
  assert.equal(second.body.code, 'EMAIL_NOT_VERIFIED');
});

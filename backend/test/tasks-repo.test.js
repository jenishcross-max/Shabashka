// Биржа услуг на живом SQL (PGlite в памяти, см. helpers/pglite.js). Здесь
// проверяется то, что не проверить заглушкой: один исполнитель на задачу,
// правка отклика вместо второго, закрытая задача не принимает откликов.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const repo = requireSrc('tasksRepo.js');

let seq = 0;
async function user(name = 'Айгуль') {
  seq += 1;
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash) VALUES ($1, $2, '+996700000000', 'x') RETURNING *`,
    [name, `u${seq}@test.kg`]
  );
  return rows[0];
}

const FIELDS = {
  title: 'Убраться в квартире',
  description: 'Две комнаты после ремонта',
  category: 'Уборка',
  city: 'Бишкек',
  address: null,
  work_format: 'offline',
  budget: 3000,
  when_text: 'в субботу',
};

async function newTask(owner, extra = {}) {
  return repo.get(await repo.create(owner.id, { ...FIELDS, ...extra }));
}

const OFFER = { price: 2500, term: 'за день', comment: 'Свой пылесос и химия' };
const HELLO = 'Выбираю вас';

test('новая задача открыта, без откликов и видна в ленте', async () => {
  const owner = await user();
  const task = await newTask(owner);
  assert.equal(task.status, 'open');
  assert.equal(task.offers_count, 0);
  assert.equal(task.owner_name, 'Айгуль');

  const { tasks, total } = await repo.list({ q: 'квартир' });
  assert.ok(total >= 1);
  assert.ok(tasks.some((t) => t.id === task.id));
  assert.equal((await repo.list({ q: 'никтонеищет' })).total, 0);
});

test('правка — только пока задача открыта', async () => {
  const owner = await user();
  const task = await newTask(owner);
  assert.equal(await repo.update(task.id, { budget: null, title: 'Помыть окна' }), true);
  const fresh = await repo.get(task.id);
  assert.equal(fresh.budget, null);
  assert.equal(fresh.title, 'Помыть окна');

  assert.equal(await repo.setStatus(task.id, owner.id, ['open'], 'cancelled'), true);
  assert.equal(await repo.update(task.id, { title: 'Ещё раз' }), false);
  assert.equal((await repo.list({ q: 'Помыть окна' })).total, 0, 'отменённой задачи нет в ленте');
});

test('сменить статус может только автор и только из нужного статуса', async () => {
  const owner = await user();
  const other = await user('Бакыт');
  const task = await newTask(owner);
  assert.equal(await repo.setStatus(task.id, other.id, ['open'], 'cancelled'), false);
  assert.equal(await repo.setStatus(task.id, owner.id, ['assigned'], 'done'), false);
  assert.equal((await repo.get(task.id)).status, 'open');
});

test('отклик: правка обновляет тот же и снова считается новым', async () => {
  const owner = await user();
  const worker = await user('Бакыт');
  const task = await newTask(owner);

  const first = await repo.saveOffer(task.id, worker.id, OFFER);
  const again = await repo.saveOffer(task.id, worker.id, { ...OFFER, price: 2000 });
  assert.equal(again.id, first.id);
  assert.equal(again.price, 2000);
  assert.equal((await repo.get(task.id)).offers_count, 1);

  assert.equal(await repo.unseenCount(owner.id), 1);
  const [seen] = await repo.offersForOwner(task.id);
  assert.equal(seen.is_new, true, 'в первом показе — новый');
  assert.equal(seen.user_name, 'Бакыт');
  assert.equal(seen.done_count, 0);
  assert.equal((await repo.offersForOwner(task.id))[0].is_new, false);
  assert.equal(await repo.unseenCount(owner.id), 0);

  await repo.saveOffer(task.id, worker.id, { ...OFFER, price: 1800 });
  assert.equal((await repo.offersForOwner(task.id))[0].is_new, true, 'после правки — снова новый');
});

test('отозванный отклик не виден заказчику, подать снова можно', async () => {
  const owner = await user();
  const worker = await user('Бакыт');
  const task = await newTask(owner);
  await repo.saveOffer(task.id, worker.id, OFFER);

  assert.equal((await repo.withdrawOffer(task.id, worker.id)).status, 'withdrawn');
  assert.equal(await repo.withdrawOffer(task.id, worker.id), null, 'второй раз отзывать нечего');
  assert.deepEqual(await repo.offersForOwner(task.id), []);

  assert.equal((await repo.saveOffer(task.id, worker.id, OFFER)).status, 'active');
});

test('мои отклики — с задачей', async () => {
  const owner = await user();
  const worker = await user('Бакыт');
  const task = await newTask(owner, { title: 'Покрасить забор' });
  await repo.saveOffer(task.id, worker.id, OFFER);
  const [mineOffer] = await repo.myOffers(worker.id);
  assert.equal(mineOffer.task_title, 'Покрасить забор');
  assert.equal(mineOffer.task_status, 'open');
  assert.equal(mineOffer.conversation_id, null);
  assert.equal((await repo.offerOf(task.id, worker.id)).id, mineOffer.id);
});

test('выбор: ровно один исполнитель, остальные ждут уже зря', async () => {
  const owner = await user();
  const a = await user('Азамат');
  const b = await user('Бакыт');
  const task = await newTask(owner);
  const offerA = await repo.saveOffer(task.id, a.id, OFFER);
  const offerB = await repo.saveOffer(task.id, b.id, OFFER);

  assert.equal(await repo.accept(task.id, a.id, offerA.id, HELLO), null, 'чужой задачей не выбрать');
  assert.equal((await repo.accept(task.id, owner.id, offerA.id, HELLO)).status, 'accepted');
  assert.equal(await repo.accept(task.id, owner.id, offerB.id, HELLO), null, 'второго не выбрать');

  assert.equal((await repo.get(task.id)).status, 'assigned');
  assert.equal((await repo.offerOf(task.id, b.id)).status, 'active');
  assert.equal(await repo.saveOffer(task.id, (await user()).id, OFFER), null, 'новых откликов нет');
  assert.equal(await repo.withdrawOffer(task.id, b.id), null, 'отзывать уже поздно');
  const [first] = await repo.offersForOwner(task.id);
  assert.equal(first.id, offerA.id, 'выбранный — первым');
});

test('нельзя выбрать отозванный отклик', async () => {
  const owner = await user();
  const a = await user('Азамат');
  const task = await newTask(owner);
  const offer = await repo.saveOffer(task.id, a.id, OFFER);
  await repo.withdrawOffer(task.id, a.id);
  assert.equal(await repo.accept(task.id, owner.id, offer.id, HELLO), null);
  assert.equal((await repo.get(task.id)).status, 'open');
});

test('переписка открывается тем же запросом, что и выбор: первое сообщение от заказчика', async () => {
  const owner = await user();
  const a = await user('Азамат');
  const task = await newTask(owner);
  const saved = await repo.saveOffer(task.id, a.id, OFFER);

  assert.equal(await repo.accept(task.id, a.id, saved.id, HELLO), null);
  const none = await db.query("SELECT id FROM conversations WHERE listing_type = 'task' AND listing_id = $1", [task.id]);
  assert.equal(none.rows.length, 0, 'неудачный выбор переписку не открывает');

  const offer = await repo.accept(task.id, owner.id, saved.id, HELLO);
  const chatId = offer.conversation_id;
  assert.ok(chatId);
  assert.equal(await repo.chosenChat(task.id), chatId);
  const { rows } = await db.query('SELECT * FROM messages WHERE conversation_id = $1', [chatId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sender_id, owner.id);
  assert.equal(rows[0].body, HELLO);
  assert.equal((await repo.myOffers(a.id))[0].conversation_id, chatId);
});

test('отмена выбора: задача снова открыта, отменённый не откликнется снова', async () => {
  const owner = await user();
  const a = await user('Азамат');
  const task = await newTask(owner);
  await repo.accept(task.id, owner.id, (await repo.saveOffer(task.id, a.id, OFFER)).id, HELLO);

  assert.equal(await repo.unassign(task.id, owner.id), true);
  assert.equal(await repo.unassign(task.id, owner.id), false, 'второй раз отменять нечего');
  assert.equal((await repo.get(task.id)).status, 'open');
  assert.equal((await repo.offerOf(task.id, a.id)).status, 'dropped');
  assert.equal(await repo.saveOffer(task.id, a.id, OFFER), null);
  assert.equal(await repo.chosenChat(task.id), null);
});

test('выполненные задачи считаются в отклике исполнителя', async () => {
  const owner = await user();
  const a = await user('Азамат');
  const done = await newTask(owner);
  await repo.accept(done.id, owner.id, (await repo.saveOffer(done.id, a.id, OFFER)).id, HELLO);
  assert.equal(await repo.setStatus(done.id, owner.id, ['assigned'], 'done'), true);

  const next = await newTask(owner);
  await repo.saveOffer(next.id, a.id, OFFER);
  assert.equal((await repo.offersForOwner(next.id))[0].done_count, 1);
});

test('модерация: снятый выбранный отклик открывает задачу заново; задачу можно закрыть', async () => {
  const owner = await user();
  const a = await user('Азамат');
  const task = await newTask(owner);
  const offer = await repo.saveOffer(task.id, a.id, OFFER);
  await repo.accept(task.id, owner.id, offer.id, HELLO);

  assert.deepEqual(await repo.removeOffer(offer.id), { removed: 1, reopened: 1 });
  assert.equal((await repo.get(task.id)).status, 'open');
  assert.equal((await repo.offerOf(task.id, a.id)).status, 'removed');

  assert.equal(await repo.closeTask(task.id), true);
  assert.equal((await repo.get(task.id)).status, 'cancelled');
  assert.equal(await repo.closeTask(task.id), false);
});

test('мои задачи — с числом новых откликов', async () => {
  const owner = await user();
  const task = await newTask(owner);
  await repo.saveOffer(task.id, (await user()).id, OFFER);
  await repo.saveOffer(task.id, (await user()).id, OFFER);
  const [mineTask] = await repo.mine(owner.id);
  assert.equal(mineTask.new_offers, 2);
  assert.equal(mineTask.offers_count, 2);

  // Как и значок в шапке: у задачи с выбранным исполнителем «новых» не бывает —
  // выбрать из них всё равно уже нельзя.
  const [first] = await repo.offersForOwner(task.id);
  await repo.saveOffer(task.id, (await user()).id, OFFER);
  await repo.accept(task.id, owner.id, first.id, HELLO);
  assert.equal((await repo.mine(owner.id))[0].new_offers, 0);
});

const db = require('./db');

// Биржа услуг: все запросы к tasks и task_offers. Правила «можно или нельзя» — в
// exchange.js; здесь то, что требует базы. Условия на статус стоят в самих
// UPDATE, а не только в роуте: между проверкой и записью заказчик мог успеть
// выбрать исполнителя во второй вкладке.

// offers_count — сколько откликов можно выбрать или уже выбрано: отозванные и
// снятые в счёт не идут, их всё равно не видно.
const TASK_FIELDS = `
  tasks.id, tasks.user_id, tasks.title, tasks.description, tasks.category, tasks.city,
  tasks.address, tasks.work_format, tasks.budget, tasks.when_text, tasks.status, tasks.views,
  tasks.created_at, tasks.updated_at, users.name AS owner_name,
  (SELECT COUNT(*) FROM task_offers o
    WHERE o.task_id = tasks.id AND o.status IN ('active', 'accepted'))::int AS offers_count
`;

const EDITABLE = ['title', 'description', 'category', 'city', 'address', 'work_format', 'budget', 'when_text'];

// Лента — только открытые задачи, новые сверху.
async function list({ category, city, q, page = 1, limit = 12 } = {}) {
  const clauses = ["tasks.status = 'open'"];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (category) clauses.push(`tasks.category = ${add(category)}`);
  if (city) clauses.push(`tasks.city ILIKE ${add(`%${city}%`)}`);
  if (q) {
    const p = add(`%${q}%`);
    clauses.push(`(tasks.title ILIKE ${p} OR tasks.description ILIKE ${p})`);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;

  const total = (await db.query(`SELECT COUNT(*)::int AS n FROM tasks ${where}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT ${TASK_FIELDS} FROM tasks JOIN users ON users.id = tasks.user_id
     ${where} ORDER BY tasks.created_at DESC LIMIT ${add(limit)} OFFSET ${add((page - 1) * limit)}`,
    params
  );
  return { tasks: rows, total };
}

async function get(id) {
  const { rows } = await db.query(
    `SELECT ${TASK_FIELDS} FROM tasks JOIN users ON users.id = tasks.user_id WHERE tasks.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function addView(id) {
  await db.query('UPDATE tasks SET views = views + 1 WHERE id = $1', [id]);
}

async function create(userId, f) {
  const { rows } = await db.query(
    `INSERT INTO tasks (user_id, title, description, category, city, address, work_format, budget, when_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [userId, f.title, f.description, f.category, f.city, f.address, f.work_format, f.budget, f.when_text]
  );
  return rows[0].id;
}

// false — задача уже не открыта (или править нечего).
async function update(id, fields) {
  const keys = EDITABLE.filter((k) => fields[k] !== undefined);
  if (!keys.length) return false;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const { rows } = await db.query(
    `UPDATE tasks SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $1 AND status = 'open' RETURNING id`,
    [id, ...keys.map((k) => fields[k])]
  );
  return rows.length > 0;
}

// Переход статуса заказчиком: только своя задача и только из from. false —
// статус успел смениться, роут ответит 409.
async function setStatus(id, ownerId, from, to) {
  const { rows } = await db.query(
    `UPDATE tasks SET status = $3, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = ANY($4::text[]) RETURNING id`,
    [id, ownerId, to, from]
  );
  return rows.length > 0;
}

// Мои задачи — с числом откликов, которых я ещё не видел. Как и значок в шапке
// (unseenCount), только у открытых задач: когда исполнитель выбран, выбирать из
// новых уже нечего.
async function mine(userId) {
  const { rows } = await db.query(
    `SELECT ${TASK_FIELDS},
            (SELECT COUNT(*) FROM task_offers o
              WHERE o.task_id = tasks.id AND tasks.status = 'open'
                AND o.status = 'active' AND o.seen_at IS NULL)::int AS new_offers
     FROM tasks JOIN users ON users.id = tasks.user_id
     WHERE tasks.user_id = $1 ORDER BY tasks.created_at DESC`,
    [userId]
  );
  return rows;
}

async function offerOf(taskId, userId) {
  const { rows } = await db.query('SELECT * FROM task_offers WHERE task_id = $1 AND user_id = $2', [
    taskId,
    userId,
  ]);
  return rows[0] || null;
}

async function offerById(id) {
  const { rows } = await db.query('SELECT * FROM task_offers WHERE id = $1', [id]);
  return rows[0] || null;
}

// Откликнуться или поправить свой отклик. Задача должна быть открыта в момент
// записи, а прежний отклик — активным или отозванным: правка не должна тихо
// отменять решение заказчика или модератора. Правка снова делает отклик
// «новым» — заказчик должен увидеть, что цена поменялась. null — нельзя.
// FOR SHARE: без блокировки статус читался бы по снимку, и отклик, пришедший в
// ту же секунду, что и выбор исполнителя, лёг бы в уже закрытую задачу; с ней
// он дожидается выбора и видит, что задача больше не открыта.
async function saveOffer(taskId, userId, { price, term, comment }) {
  const { rows } = await db.query(
    `INSERT INTO task_offers (task_id, user_id, price, term, comment)
     SELECT id, $2, $3, $4, $5 FROM tasks WHERE id = $1 AND status = 'open' FOR SHARE
     ON CONFLICT (task_id, user_id) DO UPDATE
       SET price = EXCLUDED.price, term = EXCLUDED.term, comment = EXCLUDED.comment,
           status = 'active', seen_at = NULL, updated_at = NOW()
       WHERE task_offers.status IN ('active', 'withdrawn')
     RETURNING *`,
    [taskId, userId, price, term, comment]
  );
  return rows[0] || null;
}

async function withdrawOffer(taskId, userId) {
  const { rows } = await db.query(
    `UPDATE task_offers SET status = 'withdrawn', updated_at = NOW()
     WHERE task_id = $1 AND user_id = $2 AND status = 'active'
       AND EXISTS (SELECT 1 FROM tasks WHERE id = $1 AND status = 'open')
     RETURNING *`,
    [taskId, userId]
  );
  return rows[0] || null;
}

// Отклики для заказчика — с тем, что помогает выбрать: сколько задач человек уже
// выполнил на бирже и как давно он на сайте. Отозванные, отменённые и снятые не
// показываем: выбрать их всё равно нельзя. Открытие списка помечает отклики
// увиденными; is_new считается по снимку до пометки (UPDATE в WITH выполняется
// всегда, а SELECT того же запроса видит строки до него) — один запрос вместо двух.
async function offersForOwner(taskId) {
  const { rows } = await db.query(
    `WITH seen AS (
       UPDATE task_offers SET seen_at = NOW() WHERE task_id = $1 AND seen_at IS NULL RETURNING id
     )
     SELECT o.id, o.task_id, o.user_id, o.price, o.term, o.comment, o.status,
            o.created_at, o.updated_at, (o.seen_at IS NULL) AS is_new,
            u.name AS user_name, u.created_at AS user_since,
            (SELECT COUNT(*) FROM task_offers d JOIN tasks t ON t.id = d.task_id
              WHERE d.user_id = o.user_id AND d.status = 'accepted' AND t.status = 'done')::int AS done_count
     FROM task_offers o JOIN users u ON u.id = o.user_id
     WHERE o.task_id = $1 AND o.status IN ('active', 'accepted')
     ORDER BY o.status = 'accepted' DESC, o.created_at ASC`,
    [taskId]
  );
  return rows;
}

// Значок в шапке: новые отклики на мои открытые задачи.
async function unseenCount(userId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM task_offers o JOIN tasks t ON t.id = o.task_id
     WHERE t.user_id = $1 AND t.status = 'open' AND o.status = 'active' AND o.seen_at IS NULL`,
    [userId]
  );
  return rows[0].n;
}

// Мои отклики — с задачей и перепиской, если меня выбрали.
async function myOffers(userId) {
  const { rows } = await db.query(
    `SELECT o.id, o.task_id, o.price, o.term, o.comment, o.status, o.created_at, o.updated_at,
            t.title AS task_title, t.city AS task_city, t.status AS task_status,
            c.id AS conversation_id
     FROM task_offers o
     JOIN tasks t ON t.id = o.task_id
     LEFT JOIN conversations c
       ON c.listing_type = 'task' AND c.listing_id = o.task_id AND c.seeker_id = o.user_id
     WHERE o.user_id = $1
     ORDER BY o.updated_at DESC`,
    [userId]
  );
  return rows;
}

// Выбрать исполнителя одним запросом: отклик становится accepted только вместе с
// переходом задачи open → assigned и вместе с перепиской, где первое сообщение
// (hello, см. exchange.chosenMessage) — от заказчика. Одним запросом, чтобы сбой
// посередине не оставил выбранного исполнителя без переписки. FOR UPDATE ставит
// второе одновременное «Выбрать» в очередь, и после первого оно уже не найдёт
// открытой задачи; отклик, отозванный в ту же секунду, не пройдёт проверку
// status = 'active' — и тогда ничего не меняется. На крайний случай есть
// idx_task_offers_accepted. Ветка одна на пару (задача, исполнитель).
async function accept(taskId, ownerId, offerId, hello) {
  const { rows } = await db.query(
    `WITH task AS (
       SELECT id FROM tasks WHERE id = $1 AND user_id = $2 AND status = 'open' FOR UPDATE
     ), offer AS (
       UPDATE task_offers SET status = 'accepted', updated_at = NOW()
       WHERE id = $3 AND task_id IN (SELECT id FROM task) AND status = 'active'
       RETURNING *
     ), assigned AS (
       UPDATE tasks SET status = 'assigned', updated_at = NOW()
       WHERE id IN (SELECT task_id FROM offer)
       RETURNING id
     ), chat AS (
       INSERT INTO conversations (listing_type, listing_id, seeker_id, employer_id)
       SELECT 'task', task_id, user_id, $2 FROM offer
       ON CONFLICT (listing_type, listing_id, seeker_id) DO UPDATE SET last_message_at = NOW()
       RETURNING id
     ), hello AS (
       INSERT INTO messages (conversation_id, sender_id, body) SELECT id, $2, $4 FROM chat
     )
     SELECT offer.*, (SELECT id FROM chat) AS conversation_id FROM offer`,
    [taskId, ownerId, offerId, hello]
  );
  return rows[0] || null;
}

// Исполнитель пропал — заказчик отменяет выбор, задача снова собирает отклики.
async function unassign(taskId, ownerId) {
  const { rows } = await db.query(
    `WITH task AS (
       UPDATE tasks SET status = 'open', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'assigned'
       RETURNING id
     ), dropped AS (
       UPDATE task_offers SET status = 'dropped', updated_at = NOW()
       WHERE task_id IN (SELECT id FROM task) AND status = 'accepted'
       RETURNING id
     )
     SELECT id FROM task`,
    [taskId, ownerId]
  );
  return rows.length > 0;
}

// Переписка заказчика с тем, кто сейчас выбран, — для кнопки «Написать».
async function chosenChat(taskId) {
  const { rows } = await db.query(
    `SELECT c.id FROM conversations c
     JOIN task_offers o ON o.task_id = c.listing_id AND o.user_id = c.seeker_id
     WHERE c.listing_type = 'task' AND c.listing_id = $1 AND o.status = 'accepted'`,
    [taskId]
  );
  return rows[0] ? rows[0].id : null;
}

// Снять отклик по жалобе. Если сняли выбранного исполнителя, задача снова
// открыта: иначе она осталась бы «исполнитель выбран» без исполнителя. FOR
// UPDATE — чтобы статус был свежим, а не из снимка: выбор, случившийся в ту же
// секунду, иначе прошёл бы мимо, и задача осталась бы без исполнителя.
async function removeOffer(offerId) {
  const { rows } = await db.query(
    `WITH old AS (
       SELECT id, task_id, status FROM task_offers WHERE id = $1 FOR UPDATE
     ), removed AS (
       UPDATE task_offers SET status = 'removed', updated_at = NOW()
       WHERE id IN (SELECT id FROM old) RETURNING id
     ), reopened AS (
       UPDATE tasks SET status = 'open', updated_at = NOW()
       WHERE id IN (SELECT task_id FROM old WHERE status = 'accepted') AND status = 'assigned'
       RETURNING id
     )
     SELECT (SELECT COUNT(*) FROM removed)::int AS removed, (SELECT COUNT(*) FROM reopened)::int AS reopened`,
    [offerId]
  );
  return rows[0];
}

// Закрыть задачу по жалобе: не удаляем — на неё есть жалоба, и она сама себе
// доказательство (как заказы, см. admin.js).
async function closeTask(taskId) {
  const { rows } = await db.query(
    `UPDATE tasks SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND status IN ('open', 'assigned') RETURNING id`,
    [taskId]
  );
  return rows.length > 0;
}

module.exports = {
  list,
  get,
  addView,
  create,
  update,
  setStatus,
  mine,
  offerOf,
  offerById,
  saveOffer,
  withdrawOffer,
  offersForOwner,
  unseenCount,
  myOffers,
  accept,
  unassign,
  chosenChat,
  removeOffer,
  closeTask,
};

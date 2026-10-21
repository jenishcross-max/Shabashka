// Задачи биржи — в Threads, Telegram-канал и подписчикам бота (src/telegram/
// taskShare.js): у биржи ноль задач, и охват Шабашки — главный довод для
// заказчика разместить задачу у нас. Раздаёт админ кнопкой, один раз. База —
// PGlite: «раздать один раз» держится на UPDATE … WHERE shared_at IS NULL.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const taskShare = requireSrc('telegram/taskShare.js');
const { weight, THREADS_LIMIT } = requireSrc('social/video.js');

const SITE = 'https://xn--80aaac0cyed.com';

function makeDeps() {
  const log = { sent: [], answers: [], edits: [], channel: [], threads: [], notified: [], reports: [] };
  const deps = {
    log,
    send: async (chatId, text, extra) => log.sent.push({ chatId, text, extra }),
    answer: async (id, text) => log.answers.push(text),
    edit: async (chatId, messageId, text) => log.edits.push(text),
    adminIds: ['11', '22'],
    siteUrl: SITE,
    pretty: (link) => link.replace(SITE, 'шабашка.com'),
    load: async (id) => (await db.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0],
    channel: async (html) => log.channel.push(html),
    threads: async (text) => {
      log.threads.push(text);
      return { posted: false, reason: 'антиспам' };
    },
    report: async (text) => log.reports.push(text),
    subscribers: {
      count: async () => 7,
      notify: async (task) => {
        log.notified.push(task.id);
        return { sent: 7, removed: 0 };
      },
    },
  };
  return deps;
}

let userId;
test.before(async () => {
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
     VALUES ('Айгуль', 'task-share@test.kg', '+996700006101', 'x', true, 'customer') RETURNING id`
  );
  userId = rows[0].id;
});

const task = async (fields = {}) => {
  const f = {
    title: 'Покрасить забор',
    description: 'Забор 20 метров, краска есть.',
    budget: 3000,
    when_text: 'в субботу',
    status: 'open',
    ...fields,
  };
  const { rows } = await db.query(
    `INSERT INTO tasks (user_id, title, description, category, city, budget, when_text, status)
     VALUES ($1, $2, $3, 'Ремонт', 'Бишкек', $4, $5, $6) RETURNING *`,
    [userId, f.title, f.description, f.budget, f.when_text, f.status]
  );
  return { ...rows[0], owner_name: 'Айгуль' };
};

const press = (data) => ({ id: 'q', data, from: { id: 11 }, message: { chat: { id: 11 }, message_id: 5, text: 'Новая задача' } });

test('пост в Threads влезает в 500 знаков и не теряет ссылку и зов', async () => {
  const t = await task({ description: 'Очень длинное описание задачи. '.repeat(60), budget: null });
  const text = taskShare.threadsText(t, makeDeps());
  assert.ok(weight(text) <= THREADS_LIMIT, `длина ${weight(text)}`);
  assert.match(text, /^⚡ Задача на бирже: Покрасить забор/);
  assert.match(text, /💰 цену предложите вы/);
  assert.match(text, /предложите цену и срок на сайте/);
  assert.match(text, new RegExp(`шабашка\\.com/tasks/${t.id}\\?s=t$`), 'ссылка — последней строкой, с меткой Threads');
  assert.match(text, /…/, 'описание обрезано по словам');
  assert.doesNotMatch(text, /\+996/, 'номера заказчика в посте нет');
});

test('новая задача — карточка каждому админу с кнопками и числом подписчиков', async () => {
  const deps = makeDeps();
  const t = await task();
  await taskShare.announce(t, deps);
  assert.deepEqual(deps.log.sent.map((m) => m.chatId), ['11', '22']);
  const { text, extra } = deps.log.sent[0];
  assert.match(text, /Новая задача на бирже<\/b> · #\d+/);
  assert.match(text, /Ремонт · Бишкек · 💰 3 000 сом/);
  assert.match(text, /Заказчик: Айгуль/);
  assert.match(text, /подписчикам на задачи \(7\)/);
  const buttons = extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.deepEqual(buttons, [`tk:share:${t.id}`, `tk:skip:${t.id}`]);
});

test('«Раздать» — в канал, подписчикам и в Threads, и только один раз', async () => {
  const deps = makeDeps();
  const t = await task();
  assert.equal(await taskShare.onCallback(press(`tk:share:${t.id}`), deps), true);

  assert.equal(deps.log.channel.length, 1);
  assert.match(deps.log.channel[0], /<a href="https:\/\/xn--80aaac0cyed\.com\/tasks\/\d+\?s=tg">шабашка\.com\/tasks\/\d+<\/a>/);
  assert.deepEqual(deps.log.notified, [t.id]);
  assert.equal(deps.log.threads.length, 1);
  assert.match(deps.log.edits[0], /Threads — в очереди\nTelegram-канал — ✅\nПодписчикам на задачи — 7/);

  // Threads ответил отказом позже — админ узнаёт отдельным сообщением.
  await new Promise((r) => setImmediate(r));
  assert.match(deps.log.reports[0], /в Threads не ушла: антиспам/);

  // Второй админ нажал ту же кнопку — повторно не раздаём.
  const again = makeDeps();
  await taskShare.onCallback(press(`tk:share:${t.id}`), again);
  assert.equal(again.log.channel.length + again.log.threads.length + again.log.notified.length, 0);
  assert.match(again.log.answers[0], /Уже раздана/);
  assert.ok((await db.query('SELECT shared_at FROM tasks WHERE id = $1', [t.id])).rows[0].shared_at);
});

test('отменённую не раздаём, «Не раздавать» ничего не публикует', async () => {
  const deps = makeDeps();
  const cancelled = await task({ status: 'cancelled' });
  await taskShare.onCallback(press(`tk:share:${cancelled.id}`), deps);
  assert.equal(deps.log.channel.length + deps.log.threads.length + deps.log.notified.length, 0);

  const t = await task();
  await taskShare.onCallback(press(`tk:skip:${t.id}`), deps);
  assert.equal(deps.log.channel.length + deps.log.threads.length + deps.log.notified.length, 0);
  assert.match(deps.log.edits.at(-1), /Не раздавали/);
  assert.equal(await taskShare.onCallback(press('sub:obshchepit'), deps), false, 'чужие кнопки не наши');
});

test('без канала и Threads раздаёт подписчикам и честно пишет, чего нет', async () => {
  const deps = { ...makeDeps(), channel: null, threads: null };
  const t = await task();
  await taskShare.onCallback(press(`tk:share:${t.id}`), deps);
  assert.match(deps.log.edits[0], /Threads — не настроен\nTelegram-канал — не задан\nПодписчикам на задачи — 7/);
});

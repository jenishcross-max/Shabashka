// Подписка на новые вакансии по профессии в Telegram-боте (исследование
// 18 октября 2026, см. docs/research): человек нашёл работу и ушёл — повода
// вернуться на сайт у него не было. Теперь бот раз в час присылает свежие
// вакансии по выбранным профессиям (src/telegram/subscriptions.js). База — PGlite.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const subs = requireSrc('telegram/subscriptions.js');

const sent = [];
const answers = [];
const edits = [];
const blocked = new Set();
const deps = {
  send: async (chatId, text, extra) => {
    if (blocked.has(chatId)) throw new Error('Telegram sendMessage: Forbidden: bot was blocked by the user');
    sent.push({ chatId, text, extra });
  },
  answer: async (id, text) => answers.push(text),
  edit: async (chatId, messageId, extra) => edits.push(extra),
  siteUrl: 'https://xn--80aaac0cyed.com',
  pretty: (link) => link.replace('https://xn--80aaac0cyed.com', 'шабашка.com'),
  pause: async () => {},
};

const message = (text, chatId = 501) => ({ chat: { id: chatId, type: 'private' }, from: { id: chatId }, text });
const callback = (data, chatId = 501) => ({ id: 'q', data, from: { id: chatId }, message: { chat: { id: chatId }, message_id: 9 } });
const buttons = (extra) => extra.reply_markup.inline_keyboard.flat();
// 10:00 и 23:00 по Бишкеку (UTC+6).
const AT_10 = new Date('2026-10-19T04:00:00Z');
const AT_23 = new Date('2026-10-19T17:00:00Z');

let userId;
test.before(async () => {
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
     VALUES ('Бот', 'subs@test.kg', '+996700006001', 'x', true, 'customer') RETURNING id`
  );
  userId = rows[0].id;
});

const vacancy = async (title, category, status = 'open', salary = null) =>
  (
    await db.query(
      `INSERT INTO vacancies (user_id, title, description, category, employment_type, city, work_format, experience, status, salary_min)
       VALUES ($1, $2, 'Описание', $3, 'gig', 'Бишкек', 'offline', 'no_experience', $4, $5) RETURNING id`,
      [userId, title, category, status, salary]
    )
  ).rows[0].id;

test('ссылка с сайта подписывает сразу, кнопки показывают выбранное', async () => {
  sent.length = 0;
  assert.equal(await subs.onMessage(message('/start sub_obshchepit'), deps), true);
  assert.deepEqual(await subs.categoriesOf(501), ['Общепит']);
  assert.match(sent[0].text, /✅ Подписал: Общепит/);
  assert.match(sent[0].text, /раз в час, с 9:00 до 21:00/);
  const marked = buttons(sent[0].extra).find((b) => b.callback_data === 'sub:obshchepit');
  assert.equal(marked.text, '✅ Общепит');
  assert.ok(buttons(sent[0].extra).some((b) => b.callback_data === 'sub:off'), 'есть «отписаться от всех»');

  sent.length = 0;
  assert.equal(await subs.onMessage(message('/start'), deps), true);
  assert.match(sent[0].text, /Сейчас: Общепит/);
});

test('кнопка включает и выключает профессию, «от всех» — всё', async () => {
  edits.length = 0;
  answers.length = 0;
  assert.equal(await subs.onCallback(callback('sub:prodazhi'), deps), true);
  assert.deepEqual((await subs.categoriesOf(501)).sort(), ['Общепит', 'Продажи']);
  assert.match(answers.at(-1), /Подписал: Продажи/);
  assert.ok(buttons(edits.at(-1)).some((b) => b.text === '✅ Продажи'), 'кнопки обновились');

  await subs.onCallback(callback('sub:prodazhi'), deps);
  assert.deepEqual(await subs.categoriesOf(501), ['Общепит']);
  assert.match(answers.at(-1), /Отписал: Продажи/);

  await subs.onCallback(callback('sub:off'), deps);
  assert.deepEqual(await subs.categoriesOf(501), []);
  assert.equal(await subs.onCallback(callback('ad:5'), deps), false, 'чужие кнопки не трогаем');
});

test('/stop отписывает от всего, остальное — не наше', async () => {
  await subs.onMessage(message('/start sub_ohrana'), deps);
  sent.length = 0;
  assert.equal(await subs.onMessage(message('/stop'), deps), true);
  assert.deepEqual(await subs.categoriesOf(501), []);
  assert.match(sent[0].text, /Отписал/);
  assert.equal(await subs.onMessage(message('Требуется официант, 0700123456'), deps), false);
  assert.equal(await subs.onMessage(message('/start sub_net-takoy'), deps), true, 'неизвестная — просто меню');
  assert.deepEqual(await subs.categoriesOf(501), []);
});

test('рассылка: раз в час днём, по пять на профессию, без закрытых и повторов', async () => {
  // Первый запуск только запоминает, докуда дошли: старые вакансии не шлём.
  await vacancy('Старая', 'Общепит');
  assert.deepEqual(await subs.digest({ ...deps, now: AT_10 }), { sent: 0, removed: 0 });

  for (const [chatId, slug] of [
    [601, 'obshchepit'],
    [601, 'prodazhi'],
    [602, 'ohrana'],
    [603, 'ofis'],
  ]) {
    await subs.onMessage(message(`/start sub_${slug}`, chatId), deps);
  }
  blocked.add(602);
  sent.length = 0;

  for (let i = 1; i <= 7; i += 1) await vacancy(`Официант ${i}`, 'Общепит', 'open', 30000);
  await vacancy('Закрытая', 'Общепит', 'closed');
  await vacancy('Кассир', 'Продажи');
  await vacancy('Охранник', 'Охрана');

  assert.equal(await subs.digest({ ...deps, now: AT_23 }), null, 'ночью не шлём');
  assert.equal(sent.length, 0);

  const result = await subs.digest({ ...deps, now: AT_10 });
  assert.deepEqual(result, { sent: 1, removed: 1 });
  assert.equal(sent.length, 1, 'у офиса нового нет — ему ничего');
  const { chatId, text } = sent[0];
  assert.equal(chatId, 601);
  assert.match(text, /<b>Общепит<\/b>/);
  assert.equal((text.match(/Официант \d/g) || []).length, 5, 'пять на профессию');
  assert.match(text, /Официант 7 — Бишкек, от 30 000 сом\nшабашка\.com\/vacancies\/\d+/, 'свежие — первыми');
  assert.match(text, /Ещё 2 — шабашка\.com\/rabota\/obshchepit/);
  assert.match(text, /<b>Продажи<\/b>\n• Кассир — Бишкек/);
  assert.doesNotMatch(text, /Закрытая|Старая/);
  assert.deepEqual(await subs.categoriesOf(602), [], 'заблокировал бота — подписку убрали');

  sent.length = 0;
  assert.deepEqual(await subs.digest({ ...deps, now: AT_10 }), { sent: 0, removed: 0 }, 'второй раз то же не шлём');
});

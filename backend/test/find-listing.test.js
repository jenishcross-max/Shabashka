// «🔎 Найти и снять» (src/telegram/findListing.js): админ присылает номер
// объявления, ссылку, телефон или слова — бот находит и даёт «🗑». Пришедшее
// через бота снимается дорогой ldel (сайт, канал, Threads, ссылка на ролик),
// поданное на сайте — только с сайта, со снимком в журнал. База — PGlite.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const find = requireSrc('telegram/findListing.js');

const sent = [];
const answers = [];
const deps = {
  send: async (chatId, text, extra) => sent.push({ chatId, text, extra }),
  answer: async (id, text) => answers.push(text),
  esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  url: (type, id) => `https://шабашка.com/${{ vacancy: 'vacancies', order: 'orders', ad: 'ads' }[type]}/${id}`,
};
const message = (text, chatId = 7) => ({ chat: { id: chatId, type: 'private' }, text });
const press = (data, chatId = 7) => ({ id: 'q', data, message: { chat: { id: chatId }, message_id: 1 } });
const buttons = (m) => m.extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);

let userId;
const ids = {};
test.before(async () => {
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
     VALUES ('Бот', 'find@test.kg', '+996700007001', 'x', true, 'customer') RETURNING id`
  );
  userId = rows[0].id;
  const vacancy = async (title, phone) =>
    (
      await db.query(
        `INSERT INTO vacancies (user_id, title, description, category, employment_type, city, work_format, experience, whatsapp_phone)
         VALUES ($1, $2, 'Описание', 'Общепит', 'gig', 'Бишкек', 'offline', 'no_experience', $3) RETURNING id`,
        [userId, title, phone]
      )
    ).rows[0].id;
  ids.fromBot = await vacancy('Повар в кафе', '+996 700 123-456');
  ids.fromSite = await vacancy('Официант 50% скидка', '+996555000111');
  // Заказ — с тем же номером, что у вакансии: номера у разделов свои.
  ids.order = (
    await db.query(
      `INSERT INTO orders (id, user_id, title, description, category, city, whatsapp_phone)
       VALUES ($2, $1, 'Поклеить обои', 'Описание', 'Ремонт', 'Ош', '+996700999888') RETURNING id`,
      [userId, ids.fromBot]
    )
  ).rows[0].id;
  ids.import = (
    await db.query(
      `INSERT INTO imported_listings (source, status, vacancy_id, channel_message_id, threads_post_id, instagram_media_id)
       VALUES ('channel', 'published', $1, 55, '1790', '1801') RETURNING id`,
      [ids.fromBot]
    )
  ).rows[0].id;
});

test('что прислали: ссылка, номер, телефон или слова', () => {
  assert.deepEqual(find.parseQuery('https://шабашка.com/vacancies/6683'), { type: 'vacancy', id: 6683 });
  assert.deepEqual(find.parseQuery('шабашка.com/orders/12?s=t'), { type: 'order', id: 12 });
  assert.deepEqual(find.parseQuery('6683'), { id: 6683 });
  assert.deepEqual(find.parseQuery('№ 6683'), { id: 6683 });
  assert.deepEqual(find.parseQuery('+996 (700) 123-456'), { phone: '700123456' });
  assert.deepEqual(find.parseQuery('0700 123 456'), { phone: '700123456' });
  assert.deepEqual(find.parseQuery('повар'), { text: 'повар' });
  assert.equal(find.parseQuery(' '), null);
});

test('по номеру — и где висит; пришедшее через бота снимает ldel', async () => {
  sent.length = 0;
  assert.equal(await find.onMessage(message(`/find ${ids.fromBot}`), deps), true);
  const [result] = sent;
  assert.match(result.text, /💼 <a href="https:\/\/шабашка\.com\/vacancies\/\d+">Повар в кафе<\/a>/);
  assert.match(result.text, /вакансия № \d+ · Бишкек · \+996 700 123-456 · висит: сайт, канал, Threads, Instagram/);
  assert.ok(buttons(result).includes(`ldel:${ids.import}`), 'отовсюду — той же дорогой, что в «Опубликованном»');
  // Тот же номер у заказа — тоже в списке: какой из двух снимать, видно по метке.
  assert.match(result.text, new RegExp(`заказ № ${ids.order} · Ош`));
  assert.ok(buttons(result).includes(`fd:del:order:${ids.order}`));

  sent.length = 0;
  await find.onMessage(message(`/find шабашка.com/vacancies/${ids.fromBot}`), deps);
  assert.doesNotMatch(sent[0].text, /заказ/, 'по ссылке — только тот раздел');
});

test('кнопка, потом запрос: телефон и слова; не нашёл — так и говорит', async () => {
  sent.length = 0;
  answers.length = 0;
  assert.equal(await find.onCallback(press('fd:start'), deps), true);
  assert.match(sent[0].text, /Пришлите номер объявления/);
  assert.equal(await find.onMessage(message('0700 999 888'), deps), true);
  assert.match(sent[1].text, /🧰 .*Поклеить обои.*\nзаказ № \d+ · Ош · \+996700999888 · висит: сайт/);
  assert.deepEqual(buttons(sent[1]), [`fd:del:order:${ids.order}`], 'с сайта — своей кнопкой');

  assert.equal(await find.onMessage(message('просто сообщение'), deps), false, 'без кнопки — не наше');

  sent.length = 0;
  await find.onMessage(message('/find 50%'), deps);
  assert.match(sent[0].text, /Официант 50% скидка/, 'знак % ищется как знак');
  await find.onMessage(message('/find сантехник'), deps);
  assert.match(sent[1].text, /По запросу «сантехник» ничего не нашёл/);

  sent.length = 0;
  await find.onCallback(press('fd:start'), deps);
  assert.equal(await find.onMessage(message('/cancel'), deps), true);
  assert.equal(sent[1].text, 'Ок, отменил.');
});

test('поданное на сайте снимается с сайта, со снимком в журнал', async () => {
  sent.length = 0;
  answers.length = 0;
  assert.equal(await find.onCallback(press(`fd:del:vacancy:${ids.fromSite}`), deps), true);
  assert.equal(answers.at(-1), 'Снял с сайта');
  assert.match(sent[0].text, new RegExp(`Вакансия № ${ids.fromSite} снята с сайта\\. В канал и соцсети не уходило`));
  assert.equal((await db.query('SELECT 1 FROM vacancies WHERE id = $1', [ids.fromSite])).rowCount, 0);
  const log = await db.query("SELECT * FROM moderation_log WHERE listing_type = 'vacancy' AND listing_id = $1", [ids.fromSite]);
  assert.equal(log.rows[0].action, 'removed');
  assert.equal(log.rows[0].snapshot.title, 'Официант 50% скидка');

  await find.onCallback(press(`fd:del:vacancy:${ids.fromSite}`), deps);
  assert.equal(answers.at(-1), 'Уже снято');
  assert.equal(await find.onCallback(press('gp:start'), deps), false, 'чужие кнопки не трогаем');
});

// В ролике Instagram обычно три объявления, и id ролика у всех трёх один:
// снимая одно, админ должен знать, что удалить ролик — убрать и соседей.
test('othersInReel: сколько ещё опубликованных в том же ролике', async () => {
  const imports = requireSrc('telegram/imports.js');
  for (const status of ['published', 'published', 'rejected']) {
    await db.query(`INSERT INTO imported_listings (source, status, instagram_media_id) VALUES ('channel', $1, '1801')`, [
      status,
    ]);
  }
  assert.equal(await imports.othersInReel('1801', ids.import), 2, 'снятые не считаем, себя — тоже');
  assert.equal(await imports.othersInReel(null, ids.import), 0);
});

// «Кому написать» (src/telegram/outreach.js): бот готовит админу авторов свежих
// объявлений из групп и кнопку WhatsApp с готовым текстом, а отправляет админ
// сам. Главное здесь — не превратить это в рассылку: один раз на номер, не
// больше десяти в день, без чёрного списка. База — PGlite.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const outreach = requireSrc('telegram/outreach.js');

const SITE = 'https://xn--80aaac0cyed.com';
const sent = [];
const answers = [];
const deps = {
  send: async (chatId, text, extra) => sent.push({ chatId, text, extra }),
  answer: async (id, text) => answers.push(text),
  siteUrl: SITE,
  pretty: (link) => link.replace(SITE, 'шабашка.com'),
};

let userId;
test.before(async () => {
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
     VALUES ('Бот', 'outreach@test.kg', '+996700006201', 'x', true, 'customer') RETURNING id`
  );
  userId = rows[0].id;
});

async function order(title, phone, { imported = true, status = 'open', ago = '1 hour' } = {}) {
  const { rows } = await db.query(
    `INSERT INTO orders (user_id, title, description, category, city, whatsapp_phone, is_imported, status, created_at)
     VALUES ($1, $2, 'Описание', 'Ремонт', 'Бишкек', $3, $4, $5, NOW() - $6::interval) RETURNING id`,
    [userId, title, phone, imported, status, ago]
  );
  return rows[0].id;
}

async function vacancy(title, phone) {
  const { rows } = await db.query(
    `INSERT INTO vacancies (user_id, title, description, category, employment_type, city, work_format, experience, whatsapp_phone, is_imported)
     VALUES ($1, $2, 'Описание', 'Общепит', 'gig', 'Бишкек', 'offline', 'no_experience', $3, true) RETURNING id`,
    [userId, title, phone]
  );
  return rows[0].id;
}

const urls = (message) => (message.extra ? message.extra.reply_markup.inline_keyboard.flat().map((b) => b.url).filter(Boolean) : []);

test('текст для WhatsApp: ссылка на объявление и приглашение на биржу', () => {
  const text = outreach.messageFor({ type: 'order', id: 7, title: 'Шпаклёвка' }, deps);
  assert.match(text, /^Саламатсызбы! Ваше объявление «Шпаклёвка» есть на нашем сайте Шабашка: шабашка\.com\/orders\/7/);
  assert.match(text, /шабашка\.com\/tasks\/new/);
  assert.match(text, /ответьте, уберём/, 'есть как отказаться');
  assert.equal(text.split('\n').length, 3, 'три строки, не больше');

  const vac = outreach.messageFor({ type: 'vacancy', id: 9, title: 'Официант' }, deps);
  assert.match(vac, /Ваша вакансия «Официант».*шабашка\.com\/vacancies\/9/);
  assert.match(vac, /шабашка\.com\/vacancies\/new/);

  const link = outreach.waLink({ type: 'order', id: 7, title: 'Шпаклёвка', phone: '+996 700 123-456' }, deps);
  assert.match(link, /^https:\/\/wa\.me\/996700123456\?text=/);
  assert.equal(decodeURIComponent(link.split('text=')[1]), text);
});

// Автору, который пишет по-кыргызски, — текст на кыргызском: русский от
// незнакомца он читает как рассылку. Буквы ң, ө, ү решают сразу; без них —
// два кыргызских слова.
test('объявление на кыргызском — и текст на кыргызском', () => {
  const ky = (title, description = '') => outreach.langOf({ title, description });
  assert.equal(ky('Бишкекте жумушчу керек'), 'ky', 'без особых букв, по словам');
  assert.equal(ky('Сатуучу', 'Дүкөнгө сатуучу кыз керек'), 'ky');
  assert.equal(ky('Требуется официант', 'График 2/2, зарплата от 30 000'), 'ru');
  assert.equal(ky('Бригада керек', 'Описание'), 'ru', 'одного слова мало');
  assert.equal(ky('Бармен в бар', 'Ночные смены'), 'ru');

  const order = outreach.messageFor({ type: 'order', id: 7, title: 'Үй тазалоо', description: '' }, deps);
  assert.match(order, /^Саламатсызбы! Сиздин «Үй тазалоо» жарыяңыз Шабашка сайтында жарыяланды: шабашка\.com\/orders\/7/);
  assert.match(order, /усталар өздөрү жазып.*шабашка\.com\/tasks\/new/);
  assert.match(order, /алып салабыз/);
  const vac = outreach.messageFor({ type: 'vacancy', id: 9, title: 'Сатуучу', description: 'Дүкөнгө кыз керек' }, deps);
  assert.match(vac, /«Сатуучу» вакансияңыз.*шабашка\.com\/vacancies\/9/);
  assert.match(vac, /талапкерлер сизге түз чалышат: шабашка\.com\/vacancies\/new/);
});

test('свежие из групп, подработки первыми, один раз на номер, без чёрного списка', async () => {
  const keep = await order('Бригада керек', '+996700000001');
  // Автор поста в группе (см. sourceWatcher.js): ник и ссылка на сам пост.
  await db.query(
    `INSERT INTO imported_listings (source, status, order_id, author_username, source_link)
     VALUES ('channel', 'published', $1, 'aibek_master', 'https://t.me/bishkek_rabota/77')`,
    [keep]
  );
  await order('Ещё от того же', '+996700000001', { ago: '2 hours' });
  const vac = await vacancy('Повар', '+996700000002');
  await vacancy('Повар — от того же, что и заказ', '+996700000001');
  await order('Свой, не из групп', '+996700000003', { imported: false });
  await order('Закрыт', '+996700000004', { status: 'closed' });
  await order('Старый', '+996700000005', { ago: '5 days' });
  await order('Без номера', null);
  await order('В чёрном списке', '+996700000006');
  await db.query(`INSERT INTO blocked_phones (phone, reason, expires_at) VALUES ('+996700000006', 'спам', NOW() + interval '1 day')`);

  sent.length = 0;
  await outreach.send(42, deps);
  assert.equal(sent.length, 3, 'шапка и два автора');
  assert.match(sent[0].text, /Кому написать<\/b> — 2/);
  assert.match(sent[0].text, /Не больше 10 в день/);
  assert.match(sent[1].text, new RegExp(`1\\. <b>Бригада керек</b>\\nподработка · Бишкек · \\+996700000001 · @aibek_master\\nшабашка\\.com/orders/${keep}`));
  assert.match(sent[2].text, new RegExp(`2\\. <b>Повар</b>\\nвакансия · Бишкек · \\+996700000002\\nшабашка\\.com/vacancies/${vac}`));
  // Telegram первым — по нику автора, если он есть; WhatsApp — рядом; пост в группе — ниже.
  const [byNick, wa, postLink] = urls(sent[1]);
  assert.match(byNick, /^https:\/\/t\.me\/aibek_master\?text=/);
  assert.equal(decodeURIComponent(byNick.split('text=')[1]), decodeURIComponent(wa.split('text=')[1]), 'текст тот же');
  assert.match(wa, /^https:\/\/wa\.me\/996700000001\?text=/);
  assert.equal(postLink, 'https://t.me/bishkek_rabota/77');
  const [byPhone, ...rest] = urls(sent[2]);
  assert.match(byPhone, /^https:\/\/t\.me\/\+996700000002\?text=/, 'ника нет — Telegram по номеру');
  assert.equal(rest.length, 1, 'ссылки на пост нет — и кнопки нет');
  const lastButtons = sent[2].extra.reply_markup.inline_keyboard.flat();
  assert.equal(lastButtons.at(-1).callback_data, 'or:more', '«Ещё» — под последним');

  sent.length = 0;
  await outreach.send(42, deps);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Новых авторов с номером за 3 дня нет/, 'тем же второй раз не предлагаем');
});

test('больше десяти в день не предлагает', async () => {
  for (let i = 10; i < 22; i += 1) await order(`Заказ ${i}`, `+9967000001${i}`);
  sent.length = 0;
  await outreach.send(42, deps);
  // Сегодня уже предложили двоих — значит, ещё пятерых.
  assert.equal(sent.length, 1 + 5);
  sent.length = 0;
  await outreach.send(42, deps);
  assert.equal(sent.length, 1 + 3, 'до десяти за день');
  sent.length = 0;
  await outreach.send(42, deps);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /На сегодня уже 10/);

  answers.length = 0;
  assert.equal(await outreach.onCallback({ id: 'q', data: 'or:more', message: { chat: { id: 42 } } }, deps), true);
  assert.equal(await outreach.onCallback({ id: 'q', data: 'tk:share:1', message: { chat: { id: 42 } } }, deps), false);
});

test('следом за сводкой — молча: без «на сегодня хватит» и «новых нет»', async () => {
  sent.length = 0;
  await outreach.send(42, deps, { quiet: true });
  assert.equal(sent.length, 0, 'десять за день уже предложены — сводка просто без списка');
});

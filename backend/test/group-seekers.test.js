// Ответ в группе тому, кто ищет работу (см. src/telegram/groupSeekers.js).
// 7–8 ноября 2026 в группе @Shabashkacom спрашивали «Азыркыга шабашка барбы
// ночьго?», «Эртенкиге шабашка барбы эки балабыз…» — и никто не отвечал, хотя
// свежая подработка лежала на сайте. Теперь бот отвечает: три свежих заказа и
// кнопки «вся подработка» и «получать вакансии». Работодателю — не отвечает.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at, statsStub } = require('./helpers/stub');

const stats = statsStub();
const requireSrc = install({ [at('telegram/feedStats.js')]: stats.feedStats });
const seekers = requireSrc('telegram/groupSeekers.js');

const SITE = 'https://xn--80aaac0cyed.com';
const GROUP = -1003963768548;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const ORDERS = [
  { id: 1301, listingType: 'order', parsed: { title: 'Разнорабочие на стройку', city: 'Бишкек', budget: 2000 } },
  { id: 1302, listingType: 'order', parsed: { title: 'Вынести мусор <с огорода>', city: 'Бишкек', budget: null } },
  { id: 1303, listingType: 'order', parsed: { title: 'Грузчики на 2 часа', city: 'Кант', budget: 1500 } },
];

const sent = [];
const deps = {
  groupId: String(GROUP),
  siteUrl: SITE,
  pretty: (url) => url.replace('https://xn--80aaac0cyed.com', 'шабашка.com'),
  load: async () => ORDERS,
  send: async (chatId, text, extra) => sent.push({ chatId, text, extra }),
};

let nextId = 100;
const msg = (text, extra = {}) => ({
  message_id: (nextId += 1),
  chat: { id: GROUP, type: 'supergroup', username: 'Shabashkacom' },
  from: { id: 5000 + nextId, is_bot: false },
  text,
  ...extra,
});
// Те же deps, но база отдаёт другое (или падает).
const withOrders = (orders) => ({
  ...deps,
  load: async () => {
    if (orders instanceof Error) throw orders;
    return orders;
  },
});
const buttons = (extra) => extra.reply_markup.inline_keyboard.flat();

test('узнаёт, кто ищет работу, — по-русски и по-кыргызски', () => {
  for (const text of [
    'Азыркыга шабашка барбы ночьго?',
    'Эртенкиге шабашка барбы эки балабыз 0999707412 вотс',
    'Есть работа на завтра?',
    'есть ли подработка сегодня',
    'Ищу работу грузчиком',
    'ищу подработку',
    'Нужна работа срочно',
    'Иш барбы?',
    'жумуш издеп жатам',
    'Иш керек эле',
    'Ищем работу, нас двое',
    'Работа есть?',
    'Подработка нужна',
    'Эртең иш барбы балдар',
  ]) {
    assert.ok(seekers.isSeeker(text), text);
  }
});

test('работодателя и просто болтовню за поиск работы не принимает', () => {
  for (const text of [
    'Требуются грузчики, 2000 сом, +996555123456',
    'Шабашка бар, 2 бала керек',
    'Нужны 10 парней на завтра',
    'Ищем работника на склад',
    'Ищем сотрудников, работа рядом с домом',
    'Работа есть, звоните 0555123456, оплата 1500 сом',
    'Привет всем',
    'Кто ищет работу? пишите',
    'Есть кто свободен завтра?',
    '/subs@shabashka_telegram_bot',
    'Есть работа? '.repeat(30),
    '',
  ]) {
    assert.ok(!seekers.isSeeker(text), text);
  }
});

test('отвечает на вопрос свежими заказами и кнопками, ссылки с меткой группы', async () => {
  seekers.reset();
  sent.length = 0;
  const now = Date.UTC(2026, 10, 8, 3);
  const asked = msg('Есть работа на завтра?');
  assert.equal(await seekers.onMessage(asked, deps, now), true);

  assert.equal(sent.length, 1);
  const { chatId, text, extra } = sent[0];
  assert.equal(chatId, GROUP);
  assert.equal(extra.reply_to_message_id, asked.message_id, 'ответ — на само сообщение');
  assert.equal(extra.allow_sending_without_reply, true);
  assert.match(text, /Свежая подработка/);
  assert.match(text, /Разнорабочие на стройку — 2 000 сом, Бишкек/);
  assert.match(text, /Вынести мусор &lt;с огорода&gt; — Бишкек/, 'заголовок экранирован, без суммы — только город');
  assert.match(text, /шабашка\.com\/orders\/1301\?s=tg/, 'ссылка на заказ — с меткой группы');
  assert.doesNotMatch(text, /рассылк/i, 'слово «рассылка» не используем');

  const [all, bot] = buttons(extra);
  assert.match(all.text, /Вся подработка/);
  assert.equal(all.url, `${SITE}/orders?s=tg`);
  assert.match(bot.text, /Получать вакансии/);
  assert.equal(bot.url, `${SITE}/s/menu/telegram`, 'переход в бота считается «из группы»');
  assert.equal(stats.counters['group.seeker'], 1, 'ответ виден в сводке');
});

test('на кыргызский вопрос — кыргызская шапка', async () => {
  seekers.reset();
  sent.length = 0;
  await seekers.onMessage(msg('Азыркыга шабашка барбы ночьго?'), deps, Date.UTC(2026, 10, 8, 3));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Бүгүнкү шабашкалар/);
  assert.match(sent[0].text, /баскычын басыңыз/);
});

test('не засоряет группу: одному человеку — раз в 6 часов, группе — не чаще раза в 3 минуты', async () => {
  seekers.reset();
  sent.length = 0;
  const t0 = Date.UTC(2026, 10, 8, 3);
  const one = msg('Есть работа?');
  await seekers.onMessage(one, deps, t0);
  assert.equal(sent.length, 1);

  // Тот же человек спросил ещё раз — молчим.
  assert.equal(await seekers.onMessage({ ...one, message_id: 900 }, deps, t0 + 10 * MIN), false);
  // Другой спросил через минуту — тоже молчим: ответ висит прямо над ним.
  assert.equal(await seekers.onMessage(msg('Ищу подработку'), deps, t0 + MIN), false);
  assert.equal(sent.length, 1);

  // Через 3 минуты другому отвечаем.
  assert.equal(await seekers.onMessage(msg('Ищу подработку'), deps, t0 + 3 * MIN), true);
  // Первому — снова через 6 часов.
  assert.equal(await seekers.onMessage({ ...one, message_id: 901 }, deps, t0 + 6 * HOUR), true);
  assert.equal(sent.length, 3);
});

test('чужая группа, бот, ответ на чужое сообщение и личка — мимо', async () => {
  seekers.reset();
  sent.length = 0;
  const now = Date.UTC(2026, 10, 8, 3);
  assert.equal(await seekers.onMessage(msg('Есть работа?', { chat: { id: -100777, type: 'supergroup' } }), deps, now), false);
  assert.equal(await seekers.onMessage(msg('Есть работа?', { from: { id: 1, is_bot: true } }), deps, now), false);
  assert.equal(
    await seekers.onMessage(msg('Есть работа?', { reply_to_message: { message_id: 5 } }), deps, now),
    false,
    'это разговор, а не вопрос в группу'
  );
  assert.equal(await seekers.onMessage(msg('Есть работа?', { chat: { id: 77, type: 'private' } }), deps, now), false);
  assert.equal(sent.length, 0);
});

test('группа задана именем (@Shabashkacom) — узнаёт её по username', async () => {
  seekers.reset();
  sent.length = 0;
  const byName = { ...deps, groupId: '@shabashkacom' };
  assert.equal(await seekers.onMessage(msg('Есть работа?'), byName, Date.UTC(2026, 10, 8, 3)), true);
  assert.equal(sent.length, 1);
});

test('заказов за сутки нет — отвечает кнопками, без пустого списка', async () => {
  seekers.reset();
  sent.length = 0;
  const empty = withOrders([]);
  assert.equal(await seekers.onMessage(msg('Есть работа?'), empty, Date.UTC(2026, 10, 8, 3)), true);
  assert.match(sent[0].text, /появляются каждый день/);
  assert.doesNotMatch(sent[0].text, /1\./);
  assert.equal(buttons(sent[0].extra).length, 2);
});

test('база не ответила — молчим и не падаем', async () => {
  seekers.reset();
  sent.length = 0;
  const broken = withOrders(new Error('connection terminated'));
  assert.equal(await seekers.onMessage(msg('Есть работа?'), broken, Date.UTC(2026, 10, 8, 3)), false);
  assert.equal(sent.length, 0);
});

// На Render бот работает через вебхук: апдейты разбираются одновременно, и два
// вопроса подряд оба успевали пройти проверку, пока грузились заказы.
test('два вопроса пришли одновременно — отвечаем один раз', async () => {
  seekers.reset();
  sent.length = 0;
  const now = Date.UTC(2026, 10, 8, 3);
  const answers = await Promise.all([
    seekers.onMessage(msg('Есть работа?'), deps, now),
    seekers.onMessage(msg('Ищу подработку'), deps, now),
  ]);
  assert.deepEqual(answers.sort(), [false, true]);
  assert.equal(sent.length, 1);
});

test('база не ответила — следующий вопрос не ждёт 3 минуты', async () => {
  seekers.reset();
  sent.length = 0;
  const now = Date.UTC(2026, 10, 8, 3);
  const asked = msg('Есть работа?');
  assert.equal(await seekers.onMessage(asked, withOrders(new Error('timeout')), now), false);
  assert.equal(await seekers.onMessage({ ...asked, message_id: 990 }, deps, now + 1000), true);
  assert.equal(sent.length, 1);
});

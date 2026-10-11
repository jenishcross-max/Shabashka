// Рубрики по расписанию (см. src/telegram/rubrics.js): утренний топ по зарплате,
// дневная подработка, подборка для студентов и воскресная сводка зарплат. Каждая —
// раз в день в своё окно, ни одной пустой и ни одной длиннее 500 знаков Threads.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at, chat, statsStub } = require('./helpers/stub');

delete process.env.RUBRICS;

const HOUR = 3600 * 1000;
const tg = chat();
const stats = statsStub();
const settings = new Map();
stats.feedStats.getSetting = async (key) => settings.get(key) || null;
stats.feedStats.setSetting = async (key, value) => settings.set(key, String(value));
stats.feedStats.today = (now = Date.now()) => new Date(now + 6 * HOUR).toISOString().slice(0, 10);

const vacancy = (id, title, min, extra = {}) => ({
  id,
  listingType: 'vacancy',
  salary: { min, max: null },
  parsed: { title, city: 'Бишкек', budget: min, ...extra },
});
const order = (id, title, budget) => ({ id, listingType: 'order', parsed: { title, city: 'Бишкек', budget } });

const data = {
  top: [
    vacancy(1, 'Водитель-экспедитор на грузовик', 60000),
    vacancy(2, 'Сварщик', 50000),
    vacancy(3, 'Повар в кафе', 40000),
    vacancy(4, 'Бариста', 35000),
    vacancy(5, 'Продавец-консультант', 30000),
  ],
  students: [
    vacancy(6, 'Промоутер', 20000, { for_students: true }),
    vacancy(7, 'Официант, гибкий график', 25000, { for_students: true }),
    vacancy(8, 'Курьер', 30000, { for_students: true }),
  ],
  orders: [order(9, 'Покрасить забор', 3000), order(10, 'Грузчик на 2 часа', null), order(11, 'Собрать шкаф', 1500)],
  stats: [
    { category: 'Общепит', n: 48, median: 30000 },
    { category: 'Строительство', n: 31, median: 45000 },
    { category: 'Торговля', n: 22, median: 28000 },
  ],
};

const shared = [];
const requireSrc = install({
  [at('rubricsRepo.js')]: {
    topSalary: async () => {
      if (!data.top) throw new Error('база не ответила');
      return data.top;
    },
    forStudents: async () => data.students,
    freshOrders: async () => data.orders,
    salaryStats: async () => data.stats,
  },
  [at('social/index.js')]: {
    shareRubric: async (post) => {
      shared.push(post);
      return { threads: { posted: true, id: 't' }, instagram: post.items.length ? { posted: true, id: 'i' } : null };
    },
  },
  [at('telegram/feedStats.js')]: stats.feedStats,
  [at('telegram/api.js')]: tg.api,
});

const rubrics = requireSrc('telegram/rubrics.js');
const { weight } = require('../src/social/video');

const channel = [];
const deps = {
  siteUrl: (type) => `https://xn--80aaac0cyed.com/${type === 'order' ? 'orders' : 'vacancies'}`,
  pretty: (url) => url.replace('https://xn--80aaac0cyed.com', 'шабашка.com'),
  channel: async (html) => {
    channel.push(html);
  },
};

// Время по Бишкеку (UTC+6). 6 октября 2026 — вторник, 7-е — среда, 11-е — воскресенье.
const bishkek = (day, hh, mm) => Date.UTC(2026, 9, day, hh - 6, mm);

test('утренний топ выходит с 9:00 и один раз в день', async () => {
  assert.equal(await rubrics.tick(deps, bishkek(7, 8, 55)), null, 'до девяти — рано');
  assert.equal(await rubrics.tick(deps, bishkek(7, 9, 5)), 'ok');
  assert.equal(await rubrics.tick(deps, bishkek(7, 9, 15)), null, 'второй раз за день — нет');

  const [post] = shared;
  assert.match(post.text, /^💰 Топ-5 вакансий дня по зарплате\n\n1\. Водитель-экспедитор на грузовик — от 60 000 сом, Бишкек/);
  assert.match(post.text, /Все вакансии — шабашка\.com\/vacancies\n🔔 Подпишись — новый топ каждый день в 9:00$/);
  assert.ok(weight(post.text) <= 500, `вес ${weight(post.text)}`);
  assert.equal(post.items.length, 5, 'в ролик — все пять');
  assert.equal(post.collection, 'Топ-5 по зарплате');
  assert.match(channel[0], /<a href="https:\/\/xn--80aaac0cyed\.com\/vacancies">шабашка\.com\/vacancies<\/a>$/);
  assert.doesNotMatch(channel[0], /Подпишись/, 'в канале вместо строки — кнопка');
  assert.equal(stats.counters['rub.ok'], 1);
});

test('проспали утро — топ выходит позже, но не к обеду', async () => {
  shared.length = 0;
  assert.equal(await rubrics.tick(deps, bishkek(8, 12, 30)), null, 'окно 9–12 прошло');
  assert.equal(await rubrics.tick(deps, bishkek(9, 11, 50)), 'ok');
  assert.match(shared[0].text, /^💰 Топ-5/);
});

test('подработка — с 13:00, студенты — по понедельникам, средам и пятницам', async () => {
  shared.length = 0;
  await rubrics.tick(deps, bishkek(6, 13, 5));
  assert.match(shared[0].text, /^🧰 Подработка на сегодня/);
  assert.match(shared[0].text, /1\. Покрасить забор — 3 000 сом, Бишкек\n2\. Грузчик на 2 часа — Бишкек/);
  assert.match(shared[0].text, /Все заказы — шабашка\.com\/orders/);
  assert.equal(await rubrics.tick(deps, bishkek(6, 17, 5)), null, 'вторник — студентов нет');

  assert.equal(await rubrics.tick(deps, bishkek(7, 17, 5)), 'ok');
  assert.match(shared.at(-1).text, /^🎓 Работа для студентов/);
  assert.equal(shared.at(-1).collection, 'Работа для студентов');
});

test('в воскресенье — сколько платят в Бишкеке, без ролика', async () => {
  shared.length = 0;
  assert.equal(await rubrics.tick(deps, bishkek(11, 12, 5)), 'ok');
  const [post] = shared;
  assert.match(post.text, /^📊 Сколько платят в Бишкеке/);
  assert.match(
    post.text,
    /Строительство — 45 000 сом\nОбщепит — 30 000 сом\nТорговля — 28 000 сом/,
    'сверху — где платят больше'
  );
  assert.match(post.text, /по 101 вакансии/);
  assert.deepEqual(post.items, [], 'кадров для ролика нет');
});

test('мало данных — пропуск, а не пустой пост', async () => {
  shared.length = 0;
  const before = stats.counters['rub.skip'] || 0;
  data.orders = data.orders.slice(0, 2);
  assert.equal(await rubrics.tick(deps, bishkek(8, 13, 5)), 'skip');
  assert.equal(await rubrics.tick(deps, bishkek(8, 13, 15)), null, 'в тот же день больше не пробует');
  assert.equal(shared.length, 0);
  assert.equal(stats.counters['rub.skip'] - before, 1);
});

test('база не ответила — пробуем снова на следующем обходе', async () => {
  shared.length = 0;
  const saved = data.top;
  data.top = null;
  assert.equal(await rubrics.tick(deps, bishkek(10, 9, 5)), 'fail');
  data.top = saved;
  assert.equal(await rubrics.tick(deps, bishkek(10, 9, 15)), 'ok');
  assert.equal(shared.length, 1);
});

test('длинные названия — пост всё равно влезает в 500 знаков', async () => {
  shared.length = 0;
  data.top = data.top.map((v) => ({
    ...v,
    parsed: { ...v.parsed, title: `${v.parsed.title} ${'с опытом работы '.repeat(10)}` },
  }));
  await rubrics.tick(deps, bishkek(12, 9, 5));
  const [post] = shared;
  assert.ok(weight(post.text) <= 500, `вес ${weight(post.text)}`);
  assert.ok(post.items.length >= 3);
  assert.match(post.text, new RegExp(`^💰 Топ-${post.items.length} вакансий`), 'заголовок — по тому, что влезло');
});

test('RUBRICS: off выключает, неизвестное отбрасывается', () => {
  assert.deepEqual(rubrics.parseList('off'), []);
  assert.deepEqual(rubrics.parseList('top, x ,orders'), ['top', 'orders']);
  assert.deepEqual(rubrics.parseList(undefined), ['top', 'orders', 'students', 'salaries']);
});

test('не влезает — убираем строки с конца, но не меньше трёх', () => {
  const post = {
    head: (n) => `Топ-${n}`,
    lines: Array.from({ length: 5 }, (_, i) => `${i + 1}. ${'х'.repeat(120)}`),
    tail: '🔔 Подпишись',
    items: [1, 2, 3, 4, 5],
    collection: (n) => `Топ-${n} по зарплате`,
  };
  const out = rubrics.render(post);
  assert.ok(weight(out.text) <= 500, `вес ${weight(out.text)}`);
  assert.equal(out.items.length, 3);
  assert.equal(out.collection, 'Топ-3 по зарплате');
  assert.match(out.text, /^Топ-3\n/);
});

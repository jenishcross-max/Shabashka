// Подборки в WhatsApp-канал по расписанию (см. src/whatsapp/digest.js): пять раз
// в день, в 15:00 — подработка, в остальные — вакансии новее прошлой подборки.
// Номеров в посте нет, у каждой строки — ссылка на сайт с меткой WhatsApp.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at, statsStub } = require('./helpers/stub');

delete process.env.WA_HOURS;

const HOUR = 3600 * 1000;
const stats = statsStub();
const settings = new Map();
stats.feedStats.getSetting = async (key) => (settings.has(key) ? settings.get(key) : null);
stats.feedStats.setSetting = async (key, value) => settings.set(key, String(value));
stats.feedStats.claimSetting = async (key, value) => {
  if (settings.get(key) === String(value)) return false;
  settings.set(key, String(value));
  return true;
};
stats.feedStats.today = (now = Date.now()) => new Date(now + 6 * HOUR).toISOString().slice(0, 10);

const vacancy = (id, title, min, max = null) => ({
  id,
  listingType: 'vacancy',
  salary: { min, max },
  parsed: { title, city: 'Бишкек', phone: '+996700111222' },
});
const order = (id, title, budget) => ({
  id,
  listingType: 'order',
  parsed: { title, city: 'Ош', budget, phone: '+996700333444' },
});

const data = {
  vacancies: [
    vacancy(14, '*Водитель* на _грузовик_', 60000),
    vacancy(13, 'Повар в кафе', 40000, 50000),
    vacancy(11, 'Грузчик, звоните 0700 123 456', null),
  ],
  orders: [order(7, 'Покрасить забор', 3000), order(6, 'Собрать шкаф', null), order(5, 'Перевезти диван', 1500)],
  failRepo: false,
};
const asked = [];
const requireSrc = install({
  [at('rubricsRepo.js')]: {
    freshVacancies: async (options) => {
      asked.push(options);
      if (data.failRepo) throw new Error('база не ответила');
      return data.vacancies;
    },
    freshOrders: async () => data.orders,
  },
  [at('telegram/feedStats.js')]: stats.feedStats,
});
const digest = requireSrc('whatsapp/digest.js');

const posted = [];
const deps = {
  siteUrl: (type) => `https://xn--80aaac0cyed.com/${type === 'order' ? 'orders' : 'vacancies'}`,
  pretty: (url) => url.replace('https://xn--80aaac0cyed.com', 'шабашка.com'),
  fail: null,
  post: async (text) => {
    if (deps.fail) throw new Error(deps.fail);
    posted.push(text);
  },
};

// Время по Бишкеку (UTC+6). 10 ноября 2026 — вторник.
const bishkek = (day, hh, mm) => Date.UTC(2026, 10, day, hh - 6, mm);

test('подборка в 9:00 — один раз; проспали больше двух часов — ждём следующую', async () => {
  assert.equal(await digest.tick(deps, bishkek(10, 8, 55)), null, 'до девяти — рано');
  assert.equal(await digest.tick(deps, bishkek(10, 9, 5)), 'ok');
  assert.equal(await digest.tick(deps, bishkek(10, 10, 40)), null, 'этот слот уже вышел');
  assert.equal(await digest.tick(deps, bishkek(10, 11, 10)), null, 'окно 9–11 закрылось, до 12 — тишина');
  assert.equal(posted.length, 1);
  assert.equal(stats.counters['wa.ok'], 1);
});

test('текст: свежие вакансии со ссылками на сайт, без номеров и без разметки WhatsApp', () => {
  const [text] = posted;
  assert.equal(
    text,
    [
      '💼 Свежие вакансии',
      '',
      '1. Водитель на грузовик — от 60 000 сом, Бишкек',
      '👉 шабашка.com/vacancies/14?s=w',
      '',
      '2. Повар в кафе — 40 000–50 000 сом, Бишкек',
      '👉 шабашка.com/vacancies/13?s=w',
      '',
      '3. Грузчик, звоните — Бишкек',
      '👉 шабашка.com/vacancies/11?s=w',
      '',
      'Все вакансии: шабашка.com/vacancies?s=w',
      'Перешлите тому, кто ищет работу 🙌',
    ].join('\n')
  );
  assert.doesNotMatch(text, /0700|996/, 'номеров нет: звонок — с карточки на сайте');
});

test('курсор: следующая подборка — только новее вышедшей', async () => {
  assert.equal(settings.get('wa:last_vacancy_id'), '14');
  assert.equal(await digest.tick(deps, bishkek(10, 12, 5)), 'ok');
  assert.equal(asked.at(-1).afterId, 14);
});

test('в 15:00 — подработка на сегодня', async () => {
  posted.length = 0;
  assert.equal(await digest.tick(deps, bishkek(10, 15, 5)), 'ok');
  assert.match(posted[0], /^🧰 Подработка на сегодня\n\n1\. Покрасить забор — 3 000 сом, Ош\n👉 шабашка\.com\/orders\/7\?s=w\n/);
  assert.match(posted[0], /\n2\. Собрать шкаф — Ош\n/, 'без бюджета — только город');
  assert.match(posted[0], /\nВсе заказы: шабашка\.com\/orders\?s=w\n/);
});

test('меньше трёх — пропуск, курсор на месте', async () => {
  posted.length = 0;
  const saved = data.vacancies;
  data.vacancies = saved.slice(0, 2);
  assert.equal(await digest.tick(deps, bishkek(10, 18, 5)), 'skip');
  data.vacancies = saved;
  assert.equal(posted.length, 0);
  assert.equal(stats.counters['wa.skip'], 1);
  assert.equal(settings.get('wa:last_vacancy_id'), '14');
  assert.equal(await digest.tick(deps, bishkek(10, 18, 15)), null, 'в этом слоте больше не пробует');
});

test('WhatsApp не принял пост — «не вышло», курсор на месте, второй раз в слот не лезем', async () => {
  posted.length = 0;
  settings.set('wa:last_vacancy_id', '10');
  deps.fail = 'WhatsApp не подключился за минуту';
  try {
    assert.equal(await digest.tick(deps, bishkek(10, 21, 5)), 'fail');
    assert.equal(await digest.tick(deps, bishkek(10, 21, 15)), null);
  } finally {
    deps.fail = null;
  }
  assert.equal(stats.counters['wa.fail'], 1);
  assert.equal(settings.get('wa:last_vacancy_id'), '10');
});

test('база не ответила — слот освобождается, следующий обход пробует снова', async () => {
  posted.length = 0;
  data.failRepo = true;
  assert.equal(await digest.tick(deps, bishkek(11, 9, 5)), 'fail');
  data.failRepo = false;
  assert.equal(await digest.tick(deps, bishkek(11, 9, 15)), 'ok');
  assert.equal(posted.length, 1);
});

test('вне расписания (/whatsapp now) — вакансии сразу', async () => {
  posted.length = 0;
  settings.set('wa:last_vacancy_id', '0');
  assert.equal(await digest.publish(deps), 'ok');
  assert.match(posted[0], /^💼 Свежие вакансии/);
});

test('часы из WA_HOURS', () => {
  assert.deepEqual(digest.parseHours(''), [9, 12, 15, 18, 21]);
  assert.deepEqual(digest.parseHours(undefined), [9, 12, 15, 18, 21]);
  assert.deepEqual(digest.parseHours('off'), []);
  assert.deepEqual(digest.parseHours('21, 9,x,25,9'), [9, 21]);
});

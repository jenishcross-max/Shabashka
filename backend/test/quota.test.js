// Суточная норма публикаций в Instagram: свой потолок, потолок площадки и
// исключение для платной рекламы (см. src/social/quota.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const QUOTA = path.resolve(__dirname, '..', 'src', 'social', 'quota.js');

// Модуль считает потолок при загрузке, из переменной окружения, — значит, на
// каждый набор настроек нужен свой экземпляр.
function fresh(env = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  delete require.cache[QUOTA];
  const quota = require(QUOTA);
  process.env = saved;
  return quota;
}

test('по умолчанию — десять публикаций в сутки, из них восемь роликами', () => {
  const quota = fresh({ INSTAGRAM_DAILY_LIMIT: '' });
  assert.equal(quota.hardLimit(), 10);
  assert.equal(quota.RESERVE, 2, 'запас — пятая часть потолка, а не фиксированный десяток');
  assert.equal(quota.dailyLimit(), 8);
});

test('запас растёт вместе с потолком, но не съедает его целиком', () => {
  assert.equal(fresh({ INSTAGRAM_DAILY_LIMIT: '50' }).dailyLimit(), 40);
  assert.equal(fresh({ INSTAGRAM_DAILY_LIMIT: '100' }).dailyLimit(), 90);
  // Потолок в одну публикацию — вырожденный случай, но упасть на нём нельзя.
  assert.ok(fresh({ INSTAGRAM_DAILY_LIMIT: '1' }).dailyLimit() >= 1);
});

test('места кончаются на мягком потолке, а картинка добирает до жёсткого', () => {
  const quota = fresh({ INSTAGRAM_DAILY_LIMIT: '10' });
  for (let i = 0; i < 8; i += 1) assert.ok(quota.take(), `ролик №${i + 1} должен пройти`);
  assert.equal(quota.left(), 0, 'под мягким потолком мест больше нет');
  assert.equal(quota.take(), false, 'девятый ролик не проходит');
  // Картинка идёт под жёстким потолком — там ещё два места (см. RESERVE).
  assert.ok(quota.take(quota.hardLimit()));
  assert.ok(quota.take(quota.hardLimit()));
  assert.equal(quota.take(quota.hardLimit()), false, 'жёсткий потолок тоже кончается');
});

test('платная реклама идёт сверх своего потолка — до нормы площадки', () => {
  const quota = fresh({ INSTAGRAM_DAILY_LIMIT: '10' });
  for (let i = 0; i < 10; i += 1) quota.take(quota.hardLimit());
  assert.equal(quota.take(quota.hardLimit()), false, 'обычное уже не проходит');
  assert.equal(quota.adLimit(), 100, 'без ответа Meta берём запасное число');
  assert.ok(quota.take(quota.adLimit()), 'реклама проходит');
});

test('число от Meta главнее своего: оно и есть настоящий потолок', async () => {
  const quota = fresh({ INSTAGRAM_DAILY_LIMIT: '50' });
  await quota.sync(async () => ({ used: 3, total: 25 }));
  assert.equal(quota.adLimit(), 25, 'потолок площадки — тот, что назвала сама Meta');
  assert.equal(quota.hardLimit(), 25, 'свой потолок выше площадочного не поднимается');
  assert.equal(quota.used(), 3, 'уже потраченное Meta считает за нас');
});

test('свои попытки после синхронизации складываются с ответом Meta, а не подменяют его', async () => {
  const quota = fresh({ INSTAGRAM_DAILY_LIMIT: '50' });
  await quota.sync(async () => ({ used: 5, total: 100 }));
  quota.take();
  quota.take();
  assert.equal(quota.used(), 7, 'пять от Meta плюс две свои');
});

test('ответ площадки не читается, когда она молчит', async () => {
  const quota = fresh({ INSTAGRAM_DAILY_LIMIT: '50' });
  quota.take();
  await quota.sync(async () => {
    throw new Error('сеть отвалилась');
  });
  assert.equal(quota.used(), 1, 'считаем по своему счётчику, а не падаем');
});

test('пока своих попыток не было, обещать срок освобождения нечем', () => {
  const quota = fresh({ INSTAGRAM_DAILY_LIMIT: '10' });
  assert.equal(quota.freeAt(), null);
  for (let i = 0; i < 8; i += 1) quota.take();
  const free = quota.freeAt();
  assert.ok(free instanceof Date, 'после своих попыток срок известен');
  const hours = (free.getTime() - Date.now()) / 3600000;
  assert.ok(hours > 23 && hours <= 24, `окно скользящее, а не до полуночи (вышло ${hours} ч)`);
});

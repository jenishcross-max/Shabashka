// Заявки на рекламу из ответов под постами Threads (см. src/social/leads.js).
// Под постами за день десятки ответов про вакансии — «номер?», «ещё
// актуально?», «сколько платят?». Бот должен присылать только те, где
// спрашивают про рекламу, не присылать одно и то же дважды, не принимать свои
// же ответы за чужие и не заваливать чат старым после первого запуска.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { fakeDb } = require('./helpers/fakeDb');

const db = fakeDb();
const HOUR = 3600 * 1000;
let replies = {};
let repliesError = null;

const requireSrc = install({
  [at('db/index.js')]: db,
  [at('social/threads.js')]: {
    isConfigured: () => true,
    recentPosts: async () => [{ id: 'post-1' }, { id: 'post-2' }],
    replies: async (id) => {
      if (repliesError) throw repliesError;
      return replies[id] || [];
    },
    isPermissionError: (err) => Boolean(err && err.code === 10),
  },
});

const leads = requireSrc('social/leads.js');
const found = [];
const denied = [];
leads.start({ onLead: async (reply) => found.push(reply), onDenied: async () => denied.push(true) });

const reply = (id, text, minutesAgo, extra = {}) => ({
  id,
  text,
  username: 'user',
  at: Date.now() - minutesAgo * 60 * 1000,
  permalink: `https://threads.com/r/${id}`,
  mine: false,
  ...extra,
});

test('первый запуск только ставит отметку — старое заявками не считается', async () => {
  replies = { 'post-1': [reply('r0', 'Сколько стоит реклама?', 60 * 24)] };
  assert.equal(await leads.tick(), 0);
  assert.equal(found.length, 0);
  assert.ok(db.settings.get('leads:last_seen'), 'отметка сохранена в базе — переживёт перезапуск');
});

test('из новых ответов присылаются только вопросы про рекламу', async () => {
  // Отметка стоит «сейчас» — сдвигаем её назад, будто прошло полчаса.
  db.settings.set('leads:last_seen', String(Date.now() - HOUR));
  replies = {
    'post-1': [
      reply('r1', 'Номер скиньте пожалуйста', 20),
      reply('r2', 'Сколько платят за смену?', 15),
      reply('r3', 'Как у вас разместить объявление? Сколько стоит?', 10),
    ],
    'post-2': [
      reply('r4', 'Жарнама бересизби? Баасы канча', 5),
      reply('r5', 'Реклама — 50 сом, пишите в директ', 3, { mine: true }),
    ],
  };
  const count = await leads.tick();
  assert.equal(count, 2);
  assert.deepEqual(found.map((r) => r.id), ['r3', 'r4']);
});

test('второй обход тех же ответов заново не присылает', async () => {
  const before = found.length;
  assert.equal(await leads.tick(), 0);
  assert.equal(found.length, before);
});

test('шаблон про рекламу: ловит нужное и не ловит вопросы про работу', () => {
  for (const text of ['реклама у вас платная?', 'хочу разместить вакансию', 'скиньте прайс', 'жарнама канча турат']) {
    assert.ok(leads.AD_INTENT.test(text), text);
  }
  for (const text of ['сколько платят?', 'актуально?', 'номер', 'где находится?', 'можно без опыта?']) {
    assert.ok(!leads.AD_INTENT.test(text), text);
  }
});

test('без разрешения на ответы — одно сообщение и тишина дальше', async () => {
  db.settings.set('leads:last_seen', String(Date.now() - HOUR));
  repliesError = Object.assign(new Error('(#10) permission'), { code: 10 });
  await leads.tick();
  await leads.tick();
  assert.equal(denied.length, 1);
  repliesError = null;
});

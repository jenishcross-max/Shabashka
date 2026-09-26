// Очередь разбора: порядок задач и сторож зависших (см. src/telegram/queue.js).
//
// Сторож — не про скорость. Дорожек у очереди ровно столько, сколько ключей
// Groq, и задача, которая не заканчивается и не падает, забирает одну навсегда.
// С одним ключом это значит, что бот молча перестаёт разбирать что бы то ни
// было: объявления уходят в очередь и не возвращаются, а в чате тишина. Ровно
// так он однажды и «потерял» платную рекламу.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { install, at } = require('./helpers/stub');

const requireSrc = install({
  [at('telegram/extract.js')]: { KEY_COUNT: 1, PACE_MS: 35000 },
});
const queue = requireSrc('telegram/queue.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const never = () => new Promise(() => {});

test('реклама встаёт в голову, фоновое — в хвост, обычное — между ними', async () => {
  const order = [];
  const job = (name) => async () => {
    order.push(name);
  };

  // Первая задача занимает единственную дорожку и держит её, пока мы
  // расставляем остальные, — иначе они разберутся раньше, чем встанут в ряд.
  let release;
  queue.add(() => new Promise((r) => (release = r)));

  queue.add(job('обычное-1'));
  queue.add(job('из-группы'), { background: true });
  queue.add(job('обычное-2'));
  queue.add(job('реклама'), { priority: true });

  release();
  await wait(50);

  assert.deepEqual(order, ['реклама', 'обычное-1', 'обычное-2', 'из-группы']);
});

test('номер партии растёт вместе с очередью, а реклама не уходит в её конец', () => {
  let release;
  queue.add(() => new Promise((r) => (release = r)));
  assert.equal(queue.add(async () => {}), 2, 'первая ждущая — вторая партия');
  assert.equal(queue.add(async () => {}), 3, 'вторая ждущая — третья');
  // Реклама встаёт перед обеими, поэтому её номер — ближайший возможный, а не
  // четвёртый: по этому числу бот обещает админу срок.
  assert.equal(queue.add(async () => {}, { priority: true }), 2);
  release();
});

test('зависшая задача отпускает дорожку по сроку, а не держит её вечно', async () => {
  // Срок сторожа настоящий — десять минут, и ждать их в тесте нельзя. Сжимаем
  // время на весь тест: сторож зовёт setTimeout в момент запуска задачи, а не
  // при загрузке модуля, поэтому подменять надо до него и держать подменённым.
  const realSetTimeout = global.setTimeout;
  const realWait = (ms) => new Promise((r) => realSetTimeout(r, ms));
  global.setTimeout = (fn, ms, ...rest) =>
    realSetTimeout(fn, ms >= queue.JOB_TIMEOUT_MS ? 30 : ms, ...rest);
  delete require.cache[path.resolve(at('telegram/queue.js'))];
  const q = require(at('telegram/queue.js'));

  try {
    let done = false;
    q.add(never); // эта задача не закончится никогда
    q.add(async () => {
      done = true;
    });

    await realWait(10);
    assert.equal(done, false, 'пока дорожка занята, следующая задача ждёт');
    assert.equal(q.stalled(), 0);

    await realWait(150);
    assert.equal(done, true, 'сторож отпустил дорожку, и очередь пошла дальше');
    assert.equal(q.stalled(), 1, 'зависшую считаем — это видно в /stats');
  } finally {
    global.setTimeout = realSetTimeout;
  }
});

test('задача, упавшая с ошибкой, не останавливает очередь', async () => {
  let after = false;
  queue.add(async () => {
    throw new Error('разбор не вышел');
  });
  queue.add(async () => {
    after = true;
  });
  await wait(50);
  assert.equal(after, true);
});

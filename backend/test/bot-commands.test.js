// Бот открыт всем ради подписки на вакансии (см. src/telegram/subscriptions.js),
// поэтому: в синей кнопке «Меню» подписчик видит только команды подписки, а
// админские — только админ в своей личке (src/telegram/commands.js); посторонний
// не может завалить бота сообщениями (src/telegram/throttle.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const commands = require('../src/telegram/commands');
const throttle = require('../src/telegram/throttle');

function fakeTg({ description = '', short = '' } = {}) {
  const calls = [];
  return {
    calls,
    call: async (method, payload) => {
      calls.push({ method, payload });
      if (method === 'getMyDescription') return { description };
      if (method === 'getMyShortDescription') return { short_description: short };
      return true;
    },
  };
}

test('подписчику — три команды подписки, админу — его список в своей личке', async () => {
  const tg = fakeTg();
  await commands.setCommands(tg, ['111', '222']);
  const sets = tg.calls.filter((c) => c.method === 'setMyCommands');
  assert.equal(sets.length, 3);

  const everyone = sets.find((c) => !c.payload.scope);
  assert.deepEqual(
    everyone.payload.commands.map((c) => c.command),
    ['start', 'subs', 'stop'],
    'никаких /ad, /products и /spam у всех'
  );

  for (const id of [111, 222]) {
    const admin = sets.find((c) => c.payload.scope && c.payload.scope.chat_id === id);
    assert.equal(admin.payload.scope.type, 'chat');
    const names = admin.payload.commands.map((c) => c.command);
    for (const name of ['menu', 'ad', 'products', 'stats', 'subs']) assert.ok(names.includes(name), name);
  }
});

test('админ, с которым бот ещё не говорил, не ломает меню остальным', async () => {
  const tg = fakeTg();
  const call = tg.call;
  tg.call = async (method, payload) => {
    if (payload && payload.scope && payload.scope.chat_id === 111) throw new Error('Telegram setMyCommands: Bad Request: chat not found');
    return call(method, payload);
  };
  await commands.setCommands(tg, ['111', '222']);
  assert.ok(tg.calls.some((c) => c.payload.scope && c.payload.scope.chat_id === 222));
});

test('описание бота ставим, только если его нет: заданное в BotFather не трогаем', async () => {
  const empty = fakeTg();
  await commands.describeBot(empty);
  assert.match(empty.calls.find((c) => c.method === 'setMyDescription').payload.description, /вакансии/);
  assert.ok(empty.calls.find((c) => c.method === 'setMyShortDescription').payload.short_description.length <= 120);

  const filled = fakeTg({ description: 'Своё описание', short: 'Своё' });
  await commands.describeBot(filled);
  assert.ok(!filled.calls.some((c) => c.method.startsWith('set')), 'своё описание админа не перезаписываем');
});

test('постороннему — не больше десяти действий в минуту', () => {
  throttle.reset();
  const t0 = 1_000_000;
  const got = Array.from({ length: 15 }, (_, i) => throttle.allow(42, t0 + i));
  assert.equal(got.filter(Boolean).length, throttle.LIMIT);
  assert.equal(throttle.allow(43, t0 + 20), true, 'у другого свой счёт');
  assert.equal(throttle.allow(42, t0 + throttle.WINDOW_MS + 15), true, 'через минуту — снова можно');
});

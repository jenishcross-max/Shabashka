// «✍️ Написать в группу» (src/telegram/groupPost.js): админ присылает пост, бот
// переспрашивает и копирует его в группу от своего имени. Главное — ничего не
// уходит в группу без «Отправить» и не уходит дважды.
const test = require('node:test');
const assert = require('node:assert/strict');

const groupPost = require('../src/telegram/groupPost');

const GROUP = '-1001234';
const ADMIN = 42;

function harness({ channelId = GROUP, copyFails = false } = {}) {
  const sent = [];
  const copied = [];
  const edited = [];
  const answers = [];
  const deps = {
    channelId,
    send: async (chatId, text, extra) => sent.push({ chatId, text, extra }),
    answer: async (id, text) => answers.push(text),
    edit: async (chatId, messageId, text) => edited.push({ chatId, messageId, text }),
    copy: async (to, from, messageId) => {
      if (copyFails) throw new Error('chat not found');
      copied.push({ to, from, messageId });
    },
    esc: (s) => s,
  };
  return { deps, sent, copied, edited, answers };
}

const msg = (id, text, extra = {}) => ({ message_id: id, chat: { id: ADMIN }, text, ...extra });
const press = (data, messageId = 900) => ({ id: 'q', data, message: { chat: { id: ADMIN }, message_id: messageId } });

test('кнопка → сообщение → «Отправить?» → копия в группу, один раз', async () => {
  const h = harness();
  assert.equal(await groupPost.onCallback(press('gp:start'), h.deps), true);
  assert.match(h.sent[0].text, /Написать в группу/);

  const photo = msg(77, undefined, { photo: [{ file_id: 'f' }], caption: 'Сегодня 120 новых вакансий' });
  assert.equal(await groupPost.onMessage(photo, h.deps), true, 'пост — наш, на разбор как объявление не идёт');
  assert.equal(h.copied.length, 0, 'без подтверждения в группу ничего не уходит');
  const ask = h.sent[1];
  assert.match(ask.text, /Отправить это в группу/);
  assert.equal(ask.extra.reply_to_message_id, 77);
  assert.deepEqual(
    ask.extra.reply_markup.inline_keyboard[0].map((b) => b.callback_data),
    ['gp:send:77', 'gp:no:77']
  );

  assert.equal(await groupPost.onCallback(press('gp:send:77'), h.deps), true);
  assert.deepEqual(h.copied, [{ to: GROUP, from: ADMIN, messageId: 77 }]);
  assert.match(h.edited[0].text, /Отправлено в группу/);

  await groupPost.onCallback(press('gp:send:77'), h.deps);
  assert.equal(h.copied.length, 1, 'второе нажатие пост не дублирует');
  assert.equal(h.answers.at(-1), 'Уже отправлено');

  assert.equal(await groupPost.onMessage(msg(78, 'обычное объявление'), h.deps), false, 'ждём только одно сообщение');
});

test('отмена, команда и кнопка меню — в группу ничего не уходит', async () => {
  const h = harness();
  await groupPost.prompt(ADMIN, h.deps);
  assert.equal(await groupPost.onMessage(msg(1, '/cancel'), h.deps), true);
  assert.equal(h.sent.at(-1).text, 'Ок, отменил.');

  await groupPost.prompt(ADMIN, h.deps);
  assert.equal(await groupPost.onMessage(msg(2, '/stats'), h.deps), false, '/stats — команде, а не в группу');
  assert.equal(await groupPost.onMessage(msg(3, 'Привет'), h.deps), false, 'ожидание снято');

  await groupPost.prompt(ADMIN, h.deps);
  assert.equal(await groupPost.onMessage(msg(4, '📊 Сводка'), h.deps, { isMenuKey: (t) => t === '📊 Сводка' }), false);

  await groupPost.prompt(ADMIN, h.deps);
  await groupPost.onMessage(msg(5, 'Текст'), h.deps);
  assert.equal(await groupPost.onCallback(press('gp:no:5'), h.deps), true);
  assert.equal(h.copied.length, 0);
  assert.equal(h.edited.at(-1).text, 'Не отправлял.');
});

test('группа не задана или не приняла — админ узнаёт, а повторить можно', async () => {
  const none = harness({ channelId: '' });
  await groupPost.prompt(ADMIN, none.deps);
  assert.match(none.sent[0].text, /TELEGRAM_CHANNEL_ID/);
  assert.equal(await groupPost.onMessage(msg(10, 'Текст'), none.deps), false, 'ждать нечего — группы нет');

  const failing = harness({ copyFails: true });
  await groupPost.prompt(ADMIN, failing.deps);
  await groupPost.onMessage(msg(11, 'Текст'), failing.deps);
  await groupPost.onCallback(press('gp:send:11'), failing.deps);
  assert.match(failing.sent.at(-1).text, /В группу не ушло: chat not found/);
  assert.equal(failing.edited.length, 0, 'кнопки остаются — можно нажать ещё раз');

  assert.equal(await groupPost.onCallback(press('or:more'), failing.deps), false, 'чужие кнопки — не наши');
});

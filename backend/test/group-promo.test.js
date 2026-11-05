// Пост в Telegram-группу раз в день (см. src/telegram/groupPromo.js): как
// получать вакансии в боте и где наш WhatsApp-канал. Простыми словами и
// кнопками — в группе много взрослых людей, им непонятно слово «рассылка».
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at, statsStub } = require('./helpers/stub');

delete process.env.GROUP_PROMO;

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

const requireSrc = install({ [at('telegram/feedStats.js')]: stats.feedStats });
const groupPromo = requireSrc('telegram/groupPromo.js');

const SITE = 'https://xn--80aaac0cyed.com';
const WA = 'https://whatsapp.com/channel/0029VbDkFgd90x2sGL6f6m0p';
const sent = [];
const deps = {
  chatId: '@Shabashkacom',
  siteUrl: SITE,
  waChannel: WA,
  fail: false,
  send: async (chatId, text, extra) => {
    if (deps.fail) throw new Error('Telegram не ответил');
    sent.push({ chatId, text, extra });
  },
};
const buttons = (extra) => extra.reply_markup.inline_keyboard.flat();

// Время по Бишкеку (UTC+6).
const bishkek = (day, hh, mm) => Date.UTC(2026, 10, day, hh - 6, mm);

test('раз в день с 19:00; первым — что у нас есть канал в WhatsApp', async () => {
  assert.equal(await groupPromo.tick(deps, bishkek(6, 18, 55)), null, 'до семи — рано');
  assert.equal(await groupPromo.tick(deps, bishkek(6, 19, 5)), 'ok');
  assert.equal(await groupPromo.tick(deps, bishkek(6, 20, 15)), null, 'второй раз за день — нет');
  assert.equal(sent.length, 1);
  const [post] = sent;
  assert.equal(post.chatId, '@Shabashkacom');
  assert.match(post.text, /канал в WhatsApp/);
  assert.deepEqual(buttons(post.extra), [
    { text: '🔔 Получать вакансии', url: `${SITE}/s/menu/telegram` },
    { text: '💬 Канал в WhatsApp', url: WA },
  ]);
});

test('дальше по кругу: как подписаться в боте, по-кыргызски, снова WhatsApp', async () => {
  await groupPromo.tick(deps, bishkek(7, 19, 5));
  assert.match(sent[1].text, /1\. Нажмите «🔔 Получать вакансии»/);
  assert.match(sent[1].text, /2\. Нажмите «Запустить»/);
  await groupPromo.tick(deps, bishkek(8, 19, 5));
  assert.match(sent[2].text, /Жумуш/);
  await groupPromo.tick(deps, bishkek(9, 19, 5));
  assert.match(sent[3].text, /канал в WhatsApp/);
  for (const { text } of sent) assert.doesNotMatch(text, /рассылк/i, 'без непонятных слов');
});

test('проспали вечер — после 22:00 уже не пишем', async () => {
  const before = sent.length;
  assert.equal(await groupPromo.tick(deps, bishkek(10, 22, 5)), null);
  assert.equal(sent.length, before);
});

test('без WhatsApp-канала — только про бота, без второй кнопки', async () => {
  const noWa = { ...deps, waChannel: '' };
  const before = sent.length;
  for (const day of [11, 12, 13]) await groupPromo.tick(noWa, bishkek(day, 19, 5));
  const mine = sent.slice(before);
  assert.equal(mine.length, 3);
  for (const { text, extra } of mine) {
    assert.doesNotMatch(text, /WhatsApp/);
    assert.deepEqual(buttons(extra).map((b) => b.text), ['🔔 Получать вакансии']);
  }
});

test('Telegram не принял пост — «не вышло», в этот день больше не пробуем', async () => {
  deps.fail = true;
  try {
    assert.equal(await groupPromo.tick(deps, bishkek(14, 19, 5)), 'fail');
    assert.equal(await groupPromo.tick(deps, bishkek(14, 19, 15)), null);
  } finally {
    deps.fail = false;
  }
});

test('GROUP_PROMO — час или off', () => {
  assert.equal(groupPromo.parseHour(''), 19);
  assert.equal(groupPromo.parseHour(undefined), 19);
  assert.equal(groupPromo.parseHour('12'), 12);
  assert.equal(groupPromo.parseHour('off'), null);
  assert.equal(groupPromo.parseHour('abc'), 19);
});

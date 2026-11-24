// Строки «мы есть в WhatsApp и Telegram» (см. src/social/channels.js): в Threads —
// со ссылкой у каждого шестого поста, в Instagram — у каждого второго ролика и
// без ссылки (там ссылки в подписи не кликаются).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.WA_CHANNEL = 'https://whatsapp.com/channel/0029VbDkFgd90x2sGL6f6m0p';
delete process.env.TELEGRAM_GROUP_URL;
delete process.env.CHANNELS_EVERY;
const channels = require('../src/social/channels');

test('Threads: у каждого шестого поста, WhatsApp и Telegram по очереди, со ссылками', () => {
  const got = Array.from({ length: 12 }, () => channels.next());
  assert.deepEqual(
    got.map(Boolean),
    [false, false, false, false, false, true, false, false, false, false, false, true]
  );
  assert.match(got[5], /WhatsApp.*https:\/\/whatsapp\.com\/channel\/0029VbDkFgd90x2sGL6f6m0p$/);
  assert.match(got[11], /Telegram.*t\.me\/Shabashkacom$/);
});

test('Instagram: у каждого второго ролика — про каналы, ссылки в шапке профиля', () => {
  assert.equal(channels.instagram(), '');
  assert.match(channels.instagram(), /WhatsApp.*Telegram.*в шапке профиля/);
  assert.equal(channels.instagram(), '');
});

test('без WhatsApp-канала — только Telegram; без обоих и с off — строк нет', () => {
  const tgOnly = channels.create({ waChannel: '', telegram: 't.me/Shabashkacom', every: 1 });
  assert.match(tgOnly.next(), /Telegram/);
  assert.match(tgOnly.next(), /Telegram/);
  tgOnly.instagram();
  assert.doesNotMatch(tgOnly.instagram(), /WhatsApp/);

  const none = channels.create({ waChannel: '', telegram: 'off', every: 1 });
  assert.equal(none.next(), '');
  assert.equal(none.instagram() + none.instagram(), '');

  const off = channels.create({ waChannel: process.env.WA_CHANNEL, telegram: '', every: 'off' });
  assert.equal(off.next(), '');
});

// Ссылка на канал в посте — через шабашка.com/w (адрес сайта — из ссылки поста):
// переход посчитается в сводке, как переходы в группу по /g.
test('Threads: ссылка на WhatsApp-канал — через сайт, со счётчиком', () => {
  const both = channels.create({ waChannel: process.env.WA_CHANNEL, telegram: 't.me/Shabashkacom', every: 1 });
  assert.match(both.next('шабашка.com/vacancies/12'), /WhatsApp-канале: шабашка\.com\/w$/);
  assert.match(both.next('шабашка.com/vacancies/12'), /Telegram.*t\.me\/Shabashkacom$/);
});

// Счётчик отклика (аудит 12 ноября 2026, см. docs/research/2026-11-audit.md):
// сколько людей написали или позвонили работодателю, раньше не знал никто.
// Кнопка «💬 Написать» в подборке бота ведёт сюда, а отсюда — в WhatsApp; кнопки
// карточки на сайте шлют сюда сигнал (sendBeacon) и сами открывают WhatsApp или звонок.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { install, at } = require('./helpers/stub');

// В боевой среде адрес записан в punycode (см. README, «PUBLIC_URL»).
process.env.PUBLIC_URL = 'https://xn--80aaac0cyed.com';

const bumps = [];
const queries = [];
const VACANCIES = {
  12: { id: 12, title: 'Повар', whatsapp_phone: '+996 (555) 12-34-56' },
  13: { id: 13, title: 'Без номера', whatsapp_phone: '' },
};
const requireSrc = install({
  [at('db/index.js')]: {
    query: async (sql, params) => {
      queries.push(sql);
      const row = VACANCIES[params[0]];
      return { rows: row ? [row] : [] };
    },
  },
  [at('telegram/feedStats.js')]: { bump: async (key) => bumps.push(key) },
});

let base;
let server;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/contact', requireSrc('routes/contact.js'));
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/contact`;
});
test.after(() => server.close());

const go = async (path, headers = {}) =>
  (await fetch(`${base}/${path}`, { redirect: 'manual', headers })).headers.get('location');

test('из подборки бота — в WhatsApp работодателя, переход считается', async () => {
  bumps.length = 0;
  const location = await go('vacancy/12/digest');
  assert.match(location, /^https:\/\/wa\.me\/996555123456\?text=/);
  assert.match(decodeURIComponent(location), /«Повар»/);
  assert.deepEqual(bumps, ['contact.wa.digest']);
  // Просмотр карточки при этом не пишется: счётчик просмотров — только у сайта.
  assert.ok(queries.every((sql) => !/views\s*=\s*views/i.test(sql)));
});

test('незнакомый источник — direct, робот превью не считается', async () => {
  bumps.length = 0;
  await go('vacancy/12/kuda-to');
  await go('vacancy/12/digest', { 'user-agent': 'TelegramBot (like TwitterBot)' });
  assert.deepEqual(bumps, ['contact.wa.direct']);
});

test('без номера и без вакансии — на карточку сайта, без счётчика', async () => {
  bumps.length = 0;
  assert.equal(await go('vacancy/13/digest'), 'https://xn--80aaac0cyed.com/vacancies/13');
  assert.equal(await go('vacancy/999/digest'), 'https://xn--80aaac0cyed.com/vacancies/999');
  assert.deepEqual(bumps, []);
});

test('сигнал с сайта: WhatsApp и звонок по источнику захода', async () => {
  bumps.length = 0;
  const send = (body) =>
    fetch(`${base}/vacancy/12`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal((await send(JSON.stringify({ how: 'wa', from: 'threads' }))).status, 204);
  assert.equal((await send(JSON.stringify({ how: 'tel', from: 'direct' }))).status, 204);
  // sendBeacon шлёт text/plain — тело разбираем и такое.
  const plain = await fetch(`${base}/vacancy/12`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ how: 'tel', from: 'bot' }),
  });
  assert.equal(plain.status, 204);
  // Чужое «как» и «откуда» не плодит ключи сводки.
  assert.equal((await send(JSON.stringify({ how: 'sms', from: 'x' }))).status, 204);
  assert.deepEqual(bumps, ['contact.wa.threads', 'contact.tel.direct', 'contact.tel.bot']);
});

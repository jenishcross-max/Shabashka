// Кнопка «Новые вакансии в Telegram» на посадочной странице (см.
// src/routes/subscribe.js): сайт не знает имени бота, поэтому ведёт сюда, а
// отсюда — в бота со ссылкой на подписку (/start sub_<slug>).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { install, at } = require('./helpers/stub');

let asked = 0;
const requireSrc = install({
  [at('telegram/api.js')]: {
    hasToken: () => true,
    call: async (method) => {
      assert.equal(method, 'getMe');
      asked += 1;
      return { username: 'shabashka_test_bot' };
    },
  },
});

let base;
let server;
test.before(async () => {
  const app = express();
  app.use('/api/subscribe', requireSrc('routes/subscribe.js'));
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/subscribe`;
});
test.after(() => server.close());

const go = async (slug) => (await fetch(`${base}/${slug}`, { redirect: 'manual' })).headers.get('location');

test('профессия — сразу в подписку, подборка — в меню бота', async () => {
  assert.equal(await go('obshchepit'), 'https://t.me/shabashka_test_bot?start=sub_obshchepit');
  assert.equal(await go('studentam'), 'https://t.me/shabashka_test_bot?start');
  assert.equal(await go('net-takoy'), 'https://t.me/shabashka_test_bot?start');
  assert.equal(asked, 1, 'имя бота спрашиваем у Telegram один раз');
});

// Кнопка «Новые вакансии в Telegram» на посадочной странице (см.
// src/routes/subscribe.js): сайт не знает имени бота, поэтому ведёт сюда, а
// отсюда — в бота со ссылкой на подписку (/start sub_<slug>).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { install, at } = require('./helpers/stub');

let asked = 0;
const bumps = [];
const requireSrc = install({
  // Роут берёт у подписки только имена «birzha» и «studentam» — в базу он не ходит.
  [at('db/index.js')]: {},
  // Переходы считаются счётчиком сводки — копилкой вместо базы.
  [at('telegram/feedStats.js')]: { bump: async (key) => bumps.push(key) },
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

const go = async (path, headers = {}) =>
  (await fetch(`${base}/${path}`, { redirect: 'manual', headers })).headers.get('location');

test('профессия и «Студентам» — сразу в подписку, подборка — в меню бота', async () => {
  assert.equal(await go('obshchepit'), 'https://t.me/shabashka_test_bot?start=sub_obshchepit');
  assert.equal(await go('studentam'), 'https://t.me/shabashka_test_bot?start=sub_studentam');
  assert.equal(await go('nochnaya'), 'https://t.me/shabashka_test_bot?start');
  assert.equal(await go('net-takoy'), 'https://t.me/shabashka_test_bot?start');
  // Задачи биржи — кнопка «Новые задачи в Telegram» на странице биржи.
  assert.equal(await go('birzha'), 'https://t.me/shabashka_test_bot?start=sub_birzha');
  assert.equal(asked, 1, 'имя бота спрашиваем у Telegram один раз');
});

// Короткая ссылка из постов Threads (шабашка.com/s/<slug>, см. netlify.toml) и
// кнопки сайта приходят с источником: переход считается для сводки бота.
test('переход считается по источнику, а роботы превью — нет', async () => {
  bumps.length = 0;
  assert.equal(await go('obshchepit/threads'), 'https://t.me/shabashka_test_bot?start=sub_obshchepit');
  assert.equal(await go('menu/site'), 'https://t.me/shabashka_test_bot?start');
  assert.equal(await go('prodazhi/kuda-to'), 'https://t.me/shabashka_test_bot?start=sub_prodazhi');
  await go('obshchepit');
  // Threads, Telegram и WhatsApp сами открывают ссылку, чтобы нарисовать превью.
  await go('obshchepit/threads', { 'user-agent': 'facebookexternalhit/1.1' });
  assert.deepEqual(bumps, ['sub.click.threads', 'sub.click.site', 'sub.click.other', 'sub.click.other']);
});

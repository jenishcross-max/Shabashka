// Ссылка в Telegram-группу из постов Threads (шабашка.com/g, см. netlify.toml и
// src/social/subLine.js): бэкенд считает переход и ведёт в группу. Рядом в сводке —
// переходы в бота: так видно, что из Threads зовёт лучше (аудит 12 ноября 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { install, at } = require('./helpers/stub');

delete process.env.TELEGRAM_GROUP_URL;
process.env.WA_CHANNEL = 'https://whatsapp.com/channel/0029VbDkFgd90x2sGL6f6m0p';
const bumps = [];
const requireSrc = install({
  [at('telegram/feedStats.js')]: { bump: async (key) => bumps.push(key) },
});

let base;
let server;
test.before(async () => {
  const app = express();
  app.use('/api/go', requireSrc('routes/go.js'));
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/go`;
});
test.after(() => server.close());

const go = async (path, headers = {}) =>
  (await fetch(`${base}/${path}`, { redirect: 'manual', headers })).headers.get('location');

test('в группу — с подсчётом по источнику, роботы превью не считаются', async () => {
  assert.equal(await go('group/threads'), 'https://t.me/Shabashkacom');
  assert.equal(await go('group/kuda-to'), 'https://t.me/Shabashkacom');
  await go('group/threads', { 'user-agent': 'facebookexternalhit/1.1' });
  assert.deepEqual(bumps, ['join.click.threads', 'join.click.other']);
});

// WhatsApp-канал (22 ноября 2026, docs/plans/2026-11-22-whatsapp-instagram-growth.md):
// 58 подписчиков дали 13 откликов за день — больше, чем группа в 461 человек, а
// звали в него почти ниоткуда. Ссылка шабашка.com/w/<откуда> считает переход —
// с сайта, из шапки Instagram и Threads, из группы — и ведёт в канал.
test('в WhatsApp-канал — с подсчётом по источнику', async () => {
  bumps.length = 0;
  const channel = 'https://whatsapp.com/channel/0029VbDkFgd90x2sGL6f6m0p';
  assert.equal(await go('whatsapp/site'), channel);
  assert.equal(await go('whatsapp/instagram'), channel);
  assert.equal(await go('whatsapp'), channel);
  await go('whatsapp/site', { 'user-agent': 'WhatsApp/2.23.20.0' });
  assert.deepEqual(bumps, ['wa.click.site', 'wa.click.instagram', 'wa.click.other']);
});

test('канал не задан — ведёт на главную, а не в никуда', async () => {
  const saved = process.env.WA_CHANNEL;
  process.env.WA_CHANNEL = '';
  try {
    assert.equal(await go('whatsapp/site'), '/');
  } finally {
    process.env.WA_CHANNEL = saved;
  }
});

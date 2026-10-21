// Кнопка «Новые вакансии в Telegram» на сайте и короткая ссылка из постов
// Threads (шабашка.com/s/<slug>, см. netlify.toml и social/subLine.js). Сайт
// имени бота не знает — оно задаётся токеном, — поэтому ссылка ведёт сюда, а
// отсюда в бота: с профессией — сразу в подписку на неё (/start sub_<slug>),
// без — в меню (см. telegram/subscriptions.js).
//
// Второй кусок адреса — откуда пришли: threads или site. Переход считается
// счётчиком сводки (sub.click.<источник>): так видно, сколько людей Threads
// приводит в бота, рядом с тем, сколько он приводит на сайт (Метрика).
const express = require('express');
const asyncHandler = require('../asyncHandler');
const tg = require('../telegram/api');
const feedStats = require('../telegram/feedStats');
const landings = require('../landings');
const { TASKS } = require('../telegram/subscriptions');
const { BOT_UA_RE } = require('../bots');

const router = express.Router();

const SOURCES = ['threads', 'site'];

// Имя бота не меняется, пока не сменят токен, — а токен меняется с перезапуском.
let username = null;
async function botName() {
  if (!username) username = (await tg.call('getMe')).username;
  return username;
}

router.get(
  '/:slug/:from?',
  asyncHandler(async (req, res) => {
    if (!tg.hasToken()) return res.status(404).json({ error: 'Telegram-бот не настроен' });
    // birzha — задачи биржи для исполнителей (см. subscriptions.js), остальное —
    // профессии посадочных страниц.
    const slug = req.params.slug;
    const known = slug === TASKS.slug || landings.some((l) => l.slug === slug && l.category);
    // Threads, Telegram и WhatsApp сами открывают ссылку, чтобы нарисовать
    // превью, — это не переход человека. Счётчик не ждём: редирект важнее, а
    // ошибку базы bump глотает сам.
    if (!BOT_UA_RE.test(req.get('user-agent') || '')) {
      const from = SOURCES.includes(req.params.from) ? req.params.from : 'other';
      feedStats.bump(`sub.click.${from}`);
    }
    res.redirect(302, `https://t.me/${await botName()}?start${known ? `=sub_${slug}` : ''}`);
  })
);

module.exports = router;

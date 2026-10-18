// Кнопка «Новые вакансии в Telegram» на посадочной странице сайта (см.
// frontend/src/pages/Landing.jsx и telegram/subscriptions.js). Сайт имени бота
// не знает — оно задаётся токеном, — поэтому ссылка ведёт сюда, а отсюда в бота:
// с профессией — сразу в подписку на неё (/start sub_<slug>), без — в меню.
const express = require('express');
const asyncHandler = require('../asyncHandler');
const tg = require('../telegram/api');
const landings = require('../landings');

const router = express.Router();

// Имя бота не меняется, пока не сменят токен, — а токен меняется с перезапуском.
let username = null;
async function botName() {
  if (!username) username = (await tg.call('getMe')).username;
  return username;
}

router.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    if (!tg.hasToken()) return res.status(404).json({ error: 'Telegram-бот не настроен' });
    const page = landings.find((l) => l.slug === req.params.slug && l.category);
    res.redirect(302, `https://t.me/${await botName()}?start${page ? `=sub_${page.slug}` : ''}`);
  })
);

module.exports = router;

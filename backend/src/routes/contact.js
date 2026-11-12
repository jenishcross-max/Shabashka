// Счётчик отклика (аудит 12 ноября 2026, см. docs/research/2026-11-audit.md).
// Сколько людей написали или позвонили работодателю, не знал никто: Метрика
// видит только просмотры страниц, а кнопка WhatsApp вела прямо на wa.me. Без
// этого числа любое решение — «убрать номер из поста», «поднять кнопку» —
// принималось вслепую.
//
// GET /vacancy/:id/:from — кнопка «💬 Написать» в подборке бота (короткий адрес
// шабашка.com/c/<id>/digest, см. netlify.toml): считаем и ведём в WhatsApp
// работодателя. POST /vacancy/:id — сигнал с карточки сайта (sendBeacon): кнопка
// сама открывает WhatsApp или звонок, а сюда только сообщает, что её нажали.
//
// Просмотр карточки здесь не пишется: его считает только сама карточка.
const express = require('express');
const asyncHandler = require('../asyncHandler');
const db = require('../db');
const feedStats = require('../telegram/feedStats');
const { BOT_UA_RE } = require('../bots');

const router = express.Router();

// Откуда человек: метка захода на сайт (см. sourceTag.js) или подборка бота.
// Чужое — direct: незнакомые слова не должны плодить ключи сводки.
const SOURCES = ['threads', 'telegram', 'bot', 'whatsapp', 'digest', 'direct'];
const HOW = ['wa', 'tel'];
const sourceOf = (from) => (SOURCES.includes(from) ? from : 'direct');

const siteUrl = () => (process.env.PUBLIC_URL || '').replace(/\/$/, '');

function waLink(phone, title) {
  const text = encodeURIComponent(`Здравствуйте! Пишу по вакансии «${title}» на Шабашка.`);
  return `https://wa.me/${phone}?text=${text}`;
}

router.get(
  '/vacancy/:id/:from?',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { rows } = Number.isInteger(id)
      ? await db.query('SELECT id, title, whatsapp_phone FROM vacancies WHERE id = $1', [id])
      : { rows: [] };
    const vacancy = rows[0];
    const phone = String((vacancy && vacancy.whatsapp_phone) || '').replace(/\D/g, '');
    // Нет номера — пусть человек увидит карточку: там и переписка на сайте.
    if (!phone) return res.redirect(302, `${siteUrl()}/vacancies/${req.params.id}`);
    // Telegram сам открывает ссылку, чтобы нарисовать превью, — это не отклик.
    if (!BOT_UA_RE.test(req.get('user-agent') || '')) feedStats.bump(`contact.wa.${sourceOf(req.params.from)}`);
    res.redirect(302, waLink(phone, vacancy.title));
  })
);

// sendBeacon шлёт тело как text/plain — разбираем его сами.
router.post(
  '/vacancy/:id',
  express.text({ type: 'text/*' }),
  (req, res) => {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    const how = body && body.how;
    if (HOW.includes(how)) feedStats.bump(`contact.${how}.${sourceOf(body.from)}`);
    res.status(204).end();
  }
);

module.exports = router;

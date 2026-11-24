// Ссылка в Telegram-группу из постов Threads: шабашка.com/g (см. netlify.toml и
// social/subLine.js). Считаем переход и ведём в группу — рядом в сводке переходы
// в бота (sub.click.*): так видно, что из Threads зовёт лучше (аудит 12 ноября 2026,
// см. docs/research/2026-11-audit.md).
const express = require('express');
const feedStats = require('../telegram/feedStats');
const { BOT_UA_RE } = require('../bots');
const { inviteCode } = require('../whatsapp/channel');

const router = express.Router();
const SOURCES = ['threads'];

// TELEGRAM_GROUP_URL — тот же адрес, что у строки про каналы (см. channels.js).
function groupUrl() {
  const raw = String(process.env.TELEGRAM_GROUP_URL ?? 't.me/Shabashkacom').trim();
  if (/^(off|no|нет|-)?$/i.test(raw)) return '/';
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
}

router.get('/group/:from?', (req, res) => {
  // Threads сам открывает ссылку, чтобы нарисовать превью, — это не переход.
  if (!BOT_UA_RE.test(req.get('user-agent') || '')) {
    feedStats.bump(`join.click.${SOURCES.includes(req.params.from) ? req.params.from : 'other'}`);
  }
  res.redirect(302, groupUrl());
});

// WhatsApp-канал: шабашка.com/w/<откуда> (см. netlify.toml). 21 ноября 2026 его
// 58 подписчиков дали 13 откликов за день — больше, чем группа в 461 человек, а
// звали в канал почти ниоткуда (docs/plans/2026-11-22-whatsapp-instagram-growth.md).
// Источник — кнопка на сайте, ссылка в шапке Instagram и Threads, кнопка в группе.
const WA_SOURCES = ['site', 'threads', 'instagram', 'telegram'];

// WA_CHANNEL — та же ссылка, по которой бот выкладывает подборки (whatsapp/channel.js).
function channelUrl() {
  const code = inviteCode(process.env.WA_CHANNEL);
  return code ? `https://whatsapp.com/channel/${code}` : '/';
}

router.get('/whatsapp/:from?', (req, res) => {
  if (!BOT_UA_RE.test(req.get('user-agent') || '')) {
    feedStats.bump(`wa.click.${WA_SOURCES.includes(req.params.from) ? req.params.from : 'other'}`);
  }
  res.redirect(302, channelUrl());
});

module.exports = router;

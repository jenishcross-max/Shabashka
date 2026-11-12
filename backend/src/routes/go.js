// Ссылка в Telegram-группу из постов Threads: шабашка.com/g (см. netlify.toml и
// social/subLine.js). Считаем переход и ведём в группу — рядом в сводке переходы
// в бота (sub.click.*): так видно, что из Threads зовёт лучше (аудит 12 ноября 2026,
// см. docs/research/2026-11-audit.md).
const express = require('express');
const feedStats = require('../telegram/feedStats');
const { BOT_UA_RE } = require('../bots');

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

module.exports = router;

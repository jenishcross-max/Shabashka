const express = require('express');
const tg = require('./api');
const bot = require('./bot');

const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL || '';

const router = express.Router();

// Отвечаем Telegram сразу, а разбор запускаем в фоне: разбор скриншота занимает
// несколько секунд, а Telegram считает молчание дольше пары секунд сбоем и
// присылает тот же апдейт заново — получили бы дубли карточек.
router.post('/webhook', (req, res) => {
  if (SECRET && req.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return res.sendStatus(403);
  }
  res.sendStatus(200);
  bot.handleUpdate(req.body).catch((err) => console.error('Telegram webhook:', err));
});

// Локально webhook некуда направить — там long polling. На Render free он бы не
// работал: сервис засыпает без входящих запросов, и опрос обрывается. Вебхук,
// наоборот, будит сервис входящим POST от Telegram.
async function startPolling() {
  await tg.call('deleteWebhook', { drop_pending_updates: true });
  console.log('Telegram-бот: long polling');

  let offset = 0;
  for (;;) {
    try {
      const updates = await tg.call('getUpdates', { offset, timeout: 30 });
      for (const update of updates) {
        offset = update.update_id + 1;
        await bot.handleUpdate(update);
      }
    } catch (err) {
      console.error('Telegram polling:', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

async function start() {
  if (!bot.isConfigured()) {
    console.log('Telegram-бот выключен (нет TELEGRAM_BOT_TOKEN или TELEGRAM_ADMIN_IDS)');
    return;
  }

  if (WEBHOOK_URL) {
    await tg.call('setWebhook', {
      url: `${WEBHOOK_URL.replace(/\/$/, '')}/api/telegram/webhook`,
      secret_token: SECRET || undefined,
      allowed_updates: ['message', 'channel_post', 'callback_query'],
      drop_pending_updates: true,
    });
    console.log('Telegram-бот: webhook');
    return;
  }

  startPolling(); // намеренно без await — это бесконечный цикл
}

module.exports = { router, start };

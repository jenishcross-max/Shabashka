const tg = require('./api');

// Кто имеет право публиковать через бота и кому уходят уведомления с сайта.
// Список живёт здесь, а не в bot.js: жалобу надо доставить и тогда, когда бот
// вообще не разбирает сообщения (нет вебхука, идёт деплой) — обработчик апдейтов
// для этого не нужен, нужен только токен.
const ADMIN_IDS = new Set(
  String(process.env.TELEGRAM_ADMIN_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

function isAllowed(userId) {
  return ADMIN_IDS.has(String(userId));
}

// Жалоба, о которой узнали через неделю, бесполезна: вся защита площадки в том,
// что нарушение убрали быстро. Поэтому уведомление уходит в тот же чат, где админ
// и так публикует объявления, а не только в админку, куда надо зайти.
// Ошибку доставки глотаем: жалоба к этому моменту уже записана в базу, и ронять
// из-за недоступного Telegram ответ пользователю незачем.
async function notifyAdmins(text, extra) {
  if (!tg.hasToken() || ADMIN_IDS.size === 0) return;
  for (const id of ADMIN_IDS) {
    await tg.sendMessage(id, text, extra).catch((err) => {
      console.error(`Telegram уведомление (${id}):`, err.message);
    });
  }
}

module.exports = { ADMIN_IDS, isAllowed, notifyAdmins };

// Пост в Telegram-группу раз в день: как получать вакансии в боте и где наш
// WhatsApp-канал. 5 ноября 2026 в группе видно, что люди нажимают /subs и не
// понимают, что дальше. Подписка живёт в личке бота (см. subscriptions.js), туда
// и ведём.
//
// Пишем простыми словами и кнопками: в группе много взрослых людей, им
// непонятно слово «рассылка». Тексты идут по кругу, чтобы не примелькались:
// первым — что у нас появился канал в WhatsApp. Кыргызский текст — черновик,
// его нужно проверить носителю языка.
//
// Устроено как рубрики (см. rubrics.js): обход раз в 10 минут, окно — три часа от
// часа выхода, отметка дня в app_settings ставится до выхода.
const feedStats = require('./feedStats');

const HOUR_MS = 60 * 60 * 1000;
const TICK_MS = 10 * 60 * 1000;
const LATE_HOURS = 3;
const DAY_KEY = 'promo:group';
const TURN_KEY = 'promo:group:n';

// GROUP_PROMO — час по Бишкеку (по умолчанию 19), off — не писать.
function parseHour(value) {
  const raw = String(value ?? '').trim();
  if (/^(off|no|нет|-)$/i.test(raw)) return null;
  const hour = Number(raw);
  return raw && Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 19;
}
const HOUR = parseHour(process.env.GROUP_PROMO);

const BOT_BUTTON = '🔔 Получать вакансии';
const WA_BUTTON = '💬 Канал в WhatsApp';

// Тексты без < > и &: уходят HTML-сообщением как есть.
const TEXTS = {
  whatsapp: () =>
    [
      '📢 У Шабашки теперь есть канал в WhatsApp!',
      '',
      'Каждый день там новая работа и подработка по Кыргызстану.',
      `Подписаться бесплатно — нажмите «${WA_BUTTON}» 👇`,
    ].join('\n'),
  bot: () =>
    [
      '🔔 Не хотите пропустить работу?',
      '',
      'Бот сам пришлёт вам новые вакансии по вашей профессии — прямо в Telegram, бесплатно:',
      `1. Нажмите «${BOT_BUTTON}» 👇`,
      '2. Нажмите «Запустить»',
      '3. Выберите свою работу — готово!',
    ].join('\n'),
  kyrgyz: (wa) =>
    [
      '👷 Жумуш издеп жатасызбы?',
      '',
      `Жаңы вакансиялар өзүңүзгө Telegram'га келип турсун — «${BOT_BUTTON}» баскычын басыңыз 👇`,
      ...(wa ? [`WhatsApp'та да каналыбыз бар — «${WA_BUTTON}».`] : []),
    ].join('\n'),
};

function post(n, { siteUrl, waChannel }) {
  const order = waChannel ? ['whatsapp', 'bot', 'kyrgyz'] : ['bot', 'kyrgyz'];
  const text = TEXTS[order[n % order.length]](waChannel);
  const rows = [[{ text: BOT_BUTTON, url: `${siteUrl}/s/menu/telegram` }]];
  if (waChannel) rows.push([{ text: WA_BUTTON, url: waChannel }]);
  return { text, extra: { reply_markup: { inline_keyboard: rows } } };
}

// Один обход. deps: chatId — группа, siteUrl — адрес сайта, waChannel — ссылка
// на WhatsApp-канал (пусто — про него молчим), send(chatId, html, extra).
// Возвращает 'ok' | 'fail' или null, если писать сейчас не время.
let busy = false;
async function tick(deps, now = Date.now(), hour = HOUR) {
  if (busy || hour === null || !deps.chatId || !deps.siteUrl) return null;
  busy = true;
  try {
    const local = new Date(now + 6 * HOUR_MS).getUTCHours();
    if (local < hour || local >= hour + LATE_HOURS) return null;
    if (!(await feedStats.claimSetting(DAY_KEY, feedStats.today(now)))) return null;
    const n = Number(await feedStats.getSetting(TURN_KEY)) || 0;
    const { text, extra } = post(n, deps);
    try {
      await deps.send(deps.chatId, text, extra);
    } catch (err) {
      console.error('[группа] пост про бота не вышел:', err.message);
      return 'fail';
    }
    await feedStats.setSetting(TURN_KEY, n + 1).catch(() => {});
    return 'ok';
  } finally {
    busy = false;
  }
}

function start(deps) {
  if (HOUR === null || !deps.chatId) return;
  const run = () => tick(deps).catch((err) => console.error('[группа]', err));
  setInterval(run, TICK_MS).unref();
  setTimeout(run, 3 * 60 * 1000).unref();
  console.log(`[группа] пост про бота и каналы — каждый день с ${HOUR}:00`);
}

module.exports = { tick, start, parseHour };

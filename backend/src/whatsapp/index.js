// WhatsApp-канал Шабашки: подключение второго номера (channel.js) и подборки по
// расписанию (digest.js). Здесь — сборка из переменных Render и текст команды
// /whatsapp для бота. Пустой WA_CHANNEL — всё выключено, Baileys не грузится.
const tg = require('../telegram/api');
const { notifyAdmins } = require('../telegram/notify');
const { createChannel } = require('./channel');
const digest = require('./digest');

const channel = createChannel({
  invite: process.env.WA_CHANNEL,
  phone: process.env.WA_PHONE,
  notify: (text) => notifyAdmins(text),
});

let deps = null;

// siteUrl(type) — адрес списка на сайте, pretty(url) — как его показать.
function start({ siteUrl, pretty }) {
  if (!channel.enabled) return;
  deps = { siteUrl, pretty, post: (text) => channel.post(text) };
  channel.start();
  digest.start(deps);
}

const STATUS = {
  off: '⏸ выключен',
  unlinked: '🔌 номер не привязан',
  linking: '🔑 ждёт код с телефона',
  connecting: '⏳ подключаюсь',
  open: '✅ подключён',
  replaced: '⚠️ вход перехватил другой экземпляр бота — подключусь заново к следующей подборке',
};

// «ABCD1234» → «ABCD-1234»: так же код показывает сам WhatsApp.
const pairs = (code) => (String(code).length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : String(code));

async function linkText() {
  let code;
  try {
    code = await channel.link();
  } catch (err) {
    return `⚠️ Код не получил: ${tg.esc(err.message)}`;
  }
  if (!code) return '✅ WhatsApp уже привязан. Отвязать — на втором телефоне, в «Связанных устройствах».';
  return [
    `🔑 Код привязки: <b>${tg.esc(pairs(code))}</b>`,
    '',
    `На втором телефоне (номер +${channel.info().phone}):`,
    'WhatsApp → «Настройки» (или ⋮) → «Связанные устройства» → «Привязка устройства» → «Привязать по номеру телефона» → введите код.',
    '',
    'Код действует пару минут. Не успели — /whatsapp link ещё раз.',
  ].join('\n');
}

async function nowText() {
  if (!deps) return '⚠️ Подборки ещё не запущены — бот только стартует, попробуйте через минуту.';
  const result = await digest.publish(deps);
  if (result === 'ok') return '✅ Подборка ушла в канал.';
  if (result === 'skip') return '🤷 Новых вакансий с прошлой подборки меньше трёх — подборки нет.';
  return `⚠️ Подборка не вышла: ${tg.esc(channel.info().lastError || 'причина — в логах Render')}`;
}

function statusText() {
  const info = channel.info();
  const hours = digest.HOURS.length
    ? `${digest.HOURS.map((h) => `${h}:00`).join(', ')} (в ${digest.ORDERS_HOUR}:00 — подработка)`
    : 'выключены (WA_HOURS=off)';
  return [
    '💬 WhatsApp-канал',
    `Состояние: ${STATUS[info.status] || info.status}`,
    ...(info.name ? [`Канал: ${tg.esc(info.name)}`] : []),
    `Номер: ${info.phone ? `+${info.phone}` : 'не задан (WA_PHONE)'}`,
    `Подборки: ${hours}`,
    ...(info.lastError ? [`Последняя ошибка: ${tg.esc(info.lastError)}`] : []),
    '',
    '/whatsapp link — привязать второй номер',
    '/whatsapp now — выложить подборку сейчас',
  ].join('\n');
}

// /whatsapp, /whatsapp link, /whatsapp now — ответ боту готовым HTML.
async function command(arg = '') {
  if (!channel.enabled) {
    return '💬 WhatsApp-канал выключен: в Render не задан WA_CHANNEL (см. README, «WhatsApp-канал»).';
  }
  if (arg === 'link') return linkText();
  if (arg === 'now') return nowText();
  return statusText();
}

// Подписчики канала для сводки. Сводку WhatsApp не задерживает: не подключён —
// сразу null (будить его ради числа незачем), не ответил за waitMs или ошибся —
// тоже null, и в строке «👥 Подписчики» просто нет WhatsApp.
async function followers({ waitMs = 10 * 1000 } = {}) {
  if (!channel.enabled || channel.info().status !== 'open') return null;
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  try {
    return await Promise.race([channel.followers(), late]);
  } catch (err) {
    console.error('[whatsapp] подписчики канала:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { start, command, followers };

// Синяя кнопка «Меню» и описание бота. Бот открыт всем ради подписки на
// вакансии (см. subscriptions.js), а список команд был один на всех: подписчик
// видел админские /ad, /products, /spam. Нажать их он мог, но получал отказ —
// бот пускает к ним только TELEGRAM_ADMIN_IDS. Теперь у каждого свой список:
// всем — три команды подписки, админу в его личке — админские.
const { COMMANDS } = require('./menu');

const PUBLIC_COMMANDS = [
  { command: 'start', description: 'Вакансии и задачи биржи' },
  { command: 'subs', description: 'Мои подписки' },
  { command: 'stop', description: 'Отписаться от всех' },
];

const ADMIN_COMMANDS = [
  ...COMMANDS,
  { command: 'outreach', description: 'Кому написать: авторы объявлений из групп' },
  { command: 'subs', description: 'Подписка на вакансии и задачи' },
  { command: 'whatsapp', description: 'WhatsApp-канал: состояние и привязка' },
];

// Сначала общий список, потом по админу. Админ, с которым бот ещё не говорил
// («chat not found»), остальным меню не ломает.
async function setCommands(tg, adminIds) {
  await tg.call('setMyCommands', { commands: PUBLIC_COMMANDS });
  for (const id of adminIds) {
    try {
      await tg.call('setMyCommands', { commands: ADMIN_COMMANDS, scope: { type: 'chat', chat_id: Number(id) } });
    } catch (err) {
      console.error(`Команды админа ${id}:`, err.message);
    }
  }
}

// Описание видно в пустом чате, до кнопки «Запустить», — по нему человек решает,
// нажимать ли. Ставим, только если его ещё нет: заданное в BotFather руками не
// трогаем. «Запустить», а не «Старт»: так эта кнопка называется в русском
// Telegram, и пожилому человеку слово в подсказке должно совпадать с экраном.
const DESCRIPTION =
  'Шабашка — вакансии и подработка в Бишкеке. Нажмите «Запустить» и отметьте профессии: раз в час, с 9:00 до 21:00, пришлю свежие вакансии по ним. Без спама — только когда есть новое. Все объявления — на шабашка.com';
// Наше прежнее описание: его бот заменяет сам, это не правка админа.
const OLD_DESCRIPTIONS = [DESCRIPTION.replace('«Запустить»', '«Старт»')];
const SHORT_DESCRIPTION = 'Новые вакансии Бишкека по вашей профессии — раз в час, без спама. шабашка.com';

async function describeBot(tg) {
  const { description } = await tg.call('getMyDescription', {});
  if (!description || OLD_DESCRIPTIONS.includes(description)) {
    await tg.call('setMyDescription', { description: DESCRIPTION });
  }
  const { short_description: short } = await tg.call('getMyShortDescription', {});
  if (!short) await tg.call('setMyShortDescription', { short_description: SHORT_DESCRIPTION });
}

module.exports = { setCommands, describeBot, PUBLIC_COMMANDS, ADMIN_COMMANDS };

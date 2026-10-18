// Синяя кнопка «Меню» и описание бота. Бот открыт всем ради подписки на
// вакансии (см. subscriptions.js), а список команд был один на всех: подписчик
// видел админские /ad, /products, /spam. Нажать их он мог, но получал отказ —
// бот пускает к ним только TELEGRAM_ADMIN_IDS. Теперь у каждого свой список:
// всем — три команды подписки, админу в его личке — админские.
const { COMMANDS } = require('./menu');

const PUBLIC_COMMANDS = [
  { command: 'start', description: 'Выбрать профессии' },
  { command: 'subs', description: 'Мои подписки' },
  { command: 'stop', description: 'Отписаться от всех' },
];

const ADMIN_COMMANDS = [...COMMANDS, { command: 'subs', description: 'Подписка на вакансии' }];

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

// Описание видно в пустом чате, до кнопки «Старт», — по нему человек решает,
// нажимать ли. Ставим, только если его ещё нет: заданное в BotFather руками не
// трогаем.
const DESCRIPTION =
  'Шабашка — вакансии и подработка в Бишкеке. Нажмите «Старт» и отметьте профессии: раз в час, с 9:00 до 21:00, пришлю свежие вакансии по ним. Без спама — только когда есть новое. Все объявления — на шабашка.com';
const SHORT_DESCRIPTION = 'Новые вакансии Бишкека по вашей профессии — раз в час, без спама. шабашка.com';

async function describeBot(tg) {
  const { description } = await tg.call('getMyDescription', {});
  if (!description) await tg.call('setMyDescription', { description: DESCRIPTION });
  const { short_description: short } = await tg.call('getMyShortDescription', {});
  if (!short) await tg.call('setMyShortDescription', { short_description: SHORT_DESCRIPTION });
}

module.exports = { setCommands, describeBot, PUBLIC_COMMANDS, ADMIN_COMMANDS };

// Разовый вход в Telegram для автоимпорта из чужого канала (см. sourceWatcher.js).
// Запускается руками с компьютера один раз: `npm run telegram-login` из backend/.
//
// Почему интерактивно и нельзя автоматизировать: Telegram присылает код входа
// в сам мессенджер (или по SMS), и подтвердить его может только живой человек
// с доступом к этому аккаунту. Результат — session-строка, которая заменяет
// повторный вход при каждом перезапуске сервера.
require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');

const API_ID = Number(process.env.TELEGRAM_API_ID || 0);
const API_HASH = process.env.TELEGRAM_API_HASH || '';

async function main() {
  if (!API_ID || !API_HASH) {
    console.error(
      [
        'Сначала впишите в backend/.env:',
        '  TELEGRAM_API_ID=...',
        '  TELEGRAM_API_HASH=...',
        '',
        'Взять их на https://my.telegram.org → API development tools (нужен номер',
        'телефона того аккаунта, который подписан на канал-источник).',
      ].join('\n')
    );
    process.exit(1);
  }

  console.log('Вход в Telegram для автоимпорта из канала…\n');
  const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => input.text('Номер телефона (с кодом страны, напр. +996700123456): '),
    password: async () => input.text('Пароль двухфакторной аутентификации (если не включена — просто Enter): '),
    phoneCode: async () => input.text('Код из Telegram: '),
    onError: (err) => console.error(err),
  });

  const session = client.session.save();

  console.log('\nГотово. Вставьте эту строку в backend/.env и в переменные окружения на Render:\n');
  console.log('TELEGRAM_SESSION_STRING=' + session);
  console.log('\n⚠️  Никому не передавайте эту строку — она даёт полный доступ к вашему Telegram-аккаунту,');
  console.log('    как если бы вы вошли на новом устройстве.');

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Вход не удался:', err.message);
  process.exit(1);
});

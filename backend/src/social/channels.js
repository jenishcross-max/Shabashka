// Строки «мы есть в WhatsApp и Telegram» в постах соцсетей. Человек из Threads
// или Instagram видит одно объявление и уходит. Подписчик WhatsApp-канала или
// Telegram-группы видит работу каждый день — туда и зовём.
//
// Threads: у каждого EVERY-го поста, где нет «подпишись» (см. follow.js), —
// строка со ссылкой, по очереди WhatsApp и Telegram. Каждый пост звать нельзя:
// лента стала бы рекламой самой себя. Instagram: у каждого второго ролика вместо
// «подпишись» — без ссылки, ссылки в подписи там не кликаются. Ссылки на каналы
// владелец ставит в шапку профиля.
const { parseEvery } = require('./follow');
const { inviteCode } = require('../whatsapp/channel');

function create({ waChannel, telegram, every }) {
  const code = inviteCode(waChannel);
  const wa = code ? `https://whatsapp.com/channel/${code}` : '';
  const tg = /^(off|no|нет|-)?$/i.test(String(telegram ?? '').trim()) ? '' : String(telegram).trim();
  const each = parseEvery(every, 6);
  // Ссылка на WhatsApp-канал — через шабашка.com/w, если адрес сайта есть в ссылке
  // поста: переход посчитается в сводке (см. routes/go.js), как переходы в группу.
  const threadsLines = [
    wa && ((host) => `💬 Свежая работа каждый день — в нашем WhatsApp-канале: ${host ? `${host}/w` : wa}`),
    tg && (() => `✈️ Вакансии каждый день — в нашей Telegram-группе: ${tg}`),
  ].filter(Boolean);
  const where = [wa && 'в WhatsApp-канале', tg && 'в Telegram-группе'].filter(Boolean);
  const instagramLine = where.length
    ? `💬 Вакансии каждый день — и ${where.join(', и ')}: ссылки в шапке профиля`
    : '';

  let posts = 0;
  let turn = 0;
  let reels = 0;

  // Для потока постов Threads. siteLink — ссылка поста («шабашка.com/vacancies/12»).
  function next(siteLink = '') {
    if (!each || !threadsLines.length) return '';
    posts += 1;
    if (posts % each !== 0) return '';
    const line = threadsLines[turn % threadsLines.length];
    turn += 1;
    const host = String(siteLink || '')
      .replace(/^https?:\/\//, '')
      .split('/')[0];
    return line(host);
  }

  // Для подписи ролика Instagram.
  function instagram() {
    if (!instagramLine) return '';
    reels += 1;
    return reels % 2 === 0 ? instagramLine : '';
  }

  return { next, instagram };
}

// TELEGRAM_GROUP_URL — адрес группы (по умолчанию t.me/Shabashkacom, off — не
// звать); CHANNELS_EVERY — раз в сколько постов Threads (по умолчанию 6, off).
const main = create({
  waChannel: process.env.WA_CHANNEL,
  telegram: process.env.TELEGRAM_GROUP_URL ?? 't.me/Shabashkacom',
  every: process.env.CHANNELS_EVERY,
});

module.exports = { create, next: main.next, instagram: main.instagram };

// «☕ Утро на Шабашке · 12 ноября» — одна шапка утреннего выпуска во всех каналах:
// Threads, Telegram-группе и WhatsApp-канале (аудит 12 ноября 2026, см.
// docs/research/2026-11-audit.md). Утренние выпуски с датой — одни из самых
// просматриваемых постов у Hire.kg и DevKG: ритуал, ради которого подписываются.
const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

// Дата — по Бишкеку (UTC+6): сервер живёт в UTC.
function dayLabel(now = Date.now()) {
  const local = new Date(now + 6 * 3600 * 1000);
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}`;
}

const morningHead = (now = Date.now()) => `☕ Утро на Шабашке · ${dayLabel(now)}`;

module.exports = { morningHead, dayLabel };

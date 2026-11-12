// За что сумма в вакансии — за день или за месяц. Модель разбора отдаёт голое
// число, а в чатах пишут «1500» и про смену, и про месяц. Месячной зарплаты меньше
// 5 000 сом в Кыргызстане не бывает — значит, это оплата за день или смену. Меньше
// 300 — ошибка разбора («10 сом»), такую сумму не показываем вовсе (аудит
// 12 ноября 2026, см. docs/research/2026-11-audit.md).
//
// Те же пороги — во фронтенде (frontend/src/salary.js): карточка и разметка для
// Google должны говорить одно и то же.
const JUNK_BELOW = 300;
const DAILY_UP_TO = 4999;

// Сумма без мусора: меньше порога — как будто её нет.
const clean = (value) => (Number(value) >= JUNK_BELOW ? Number(value) : null);

// DAY или MONTH — для schema.org QuantitativeValue.unitText.
function unitText(min, max) {
  const top = Math.max(clean(min) || 0, clean(max) || 0);
  return top && top <= DAILY_UP_TO ? 'DAY' : 'MONTH';
}

module.exports = { clean, unitText, JUNK_BELOW, DAILY_UP_TO };

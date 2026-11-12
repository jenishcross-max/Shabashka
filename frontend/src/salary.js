// Зарплата в карточке вакансии. Модель разбора отдаёт голое число, а в чатах
// «1500» пишут и про смену, и про месяц. Месячной зарплаты меньше 5 000 сом в
// Кыргызстане не бывает — значит, это оплата за день или смену. Меньше 300 —
// ошибка разбора («10 сом»): такую сумму не показываем вовсе (аудит 12 ноября
// 2026, см. docs/research/2026-11-audit.md). Те же пороги — у разметки для Google
// (backend/src/salaryUnit.js): карточка и поиск должны говорить одно и то же.
export const JUNK_BELOW = 300;
export const DAILY_UP_TO = 4999;

const clean = (value) => (Number(value) >= JUNK_BELOW ? Number(value) : null);
const money = (value) => value.toLocaleString('ru-RU');

// DAY или MONTH — для schema.org (см. VacancyDetail.jsx).
export function salaryUnit(min, max) {
  const top = Math.max(clean(min) || 0, clean(max) || 0);
  return top && top <= DAILY_UP_TO ? 'DAY' : 'MONTH';
}

export function formatSalary(rawMin, rawMax) {
  const min = clean(rawMin);
  const max = clean(rawMax);
  if (!min && !max) return 'По договорённости';
  const unit = salaryUnit(min, max) === 'DAY' ? ' в день' : '';
  if (min && max) return `${money(min)}–${money(max)} сом${unit}`;
  if (min) return `от ${money(min)} сом${unit}`;
  return `до ${money(max)} сом${unit}`;
}

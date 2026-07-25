// Соответствует backend/src/employmentTypes.js — используется для мгновенного
// отображения лейбла без лишнего запроса к API.
export const EMPLOYMENT_LABELS = {
  full_time: 'Полная занятость',
  part_time: 'Частичная занятость',
  shift: 'Сменный график',
  gig: 'Подработка',
  internship: 'Стажировка',
};

export function employmentLabel(value) {
  return EMPLOYMENT_LABELS[value] || value;
}

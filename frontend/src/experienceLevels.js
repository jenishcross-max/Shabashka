// Соответствует backend/src/experienceLevels.js — используется для мгновенного
// отображения лейбла без лишнего запроса к API.
export const EXPERIENCE_LABELS = {
  no_experience: 'Без опыта',
  '1-3': 'От 1 года до 3 лет',
  '3-6': 'От 3 до 6 лет',
  '6+': 'Более 6 лет',
};

export function experienceLabel(value) {
  return EXPERIENCE_LABELS[value] || value;
}

// Русские числительные склоняются по трём формам: 1 отклик, 2 отклика, 5 откликов.
// Как frontend/src/plural.js.
export function plural(n, one, few, many) {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const offerWord = (n) => plural(n, 'отклик', 'отклика', 'откликов');
export const viewWord = (n) => plural(n, 'просмотр', 'просмотра', 'просмотров');

// Как frontend/src/formatDate.js, но «5 дней назад», а не «5 дня назад».
// now — параметром, чтобы тест не зависел от сегодняшней даты.
export function relativeDate(iso, now = new Date()) {
  const date = new Date(iso);
  const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  return date.toLocaleDateString('ru-RU');
}

export function relativeDate(isoString) {
  // Postgres timestamptz сериализуется в валидный ISO ("...T...Z") — парсим как есть.
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays <= 0) return 'сегодня';
  if (diffDays === 1) return 'вчера';
  if (diffDays < 7) return `${diffDays} дня назад`;
  return date.toLocaleDateString('ru-RU');
}

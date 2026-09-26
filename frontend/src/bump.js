// Когда объявление можно будет поднять снова. То же правило, что и на бэкенде
// (см. backend/src/bump.js): раз в сутки от последнего поднятия, а если его не
// было — от публикации. Здесь оно нужно не вместо проверки на сервере, а чтобы
// кнопка не предлагала того, чего нельзя: нажать и получить отказ — хуже, чем
// сразу видеть, когда будет можно.
const HOURS = 24;

export function bumpAvailableAt(listing) {
  const last = listing.bumped_at || listing.created_at;
  if (!last) return null;
  return new Date(new Date(last).getTime() + HOURS * 60 * 60 * 1000);
}

// Строка для подсказки на кнопке: «можно будет 26 сентября в 14:05».
export function bumpHint(listing, now = Date.now()) {
  const at = bumpAvailableAt(listing);
  if (!at || at.getTime() <= now) return '';
  return `Поднимать можно раз в сутки — следующий раз ${at.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

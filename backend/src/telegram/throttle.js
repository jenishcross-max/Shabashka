// Сколько раз посторонний может дёрнуть бота. Бот открыт всем ради подписки на
// вакансии, и кто-то может завалить его сообщениями или нажатиями кнопок: на
// каждое бот отвечает, а Telegram пускает около 30 ответов в секунду на всего
// бота — и тогда медленно отвечал бы и админам. Сверх нормы посторонних молча
// пропускаем. Админов не считаем.
const LIMIT = 10;
const WINDOW_MS = 60 * 1000;
// Счёт живёт в памяти; чтобы он не рос без конца, тихих давно убираем.
const MAX_USERS = 5000;

const hits = new Map();

function allow(userId, now = Date.now()) {
  const key = String(userId);
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  const ok = recent.length < LIMIT;
  if (ok) recent.push(now);
  hits.set(key, recent);
  if (hits.size > MAX_USERS) {
    for (const [k, list] of hits) if (!list.length || now - list[list.length - 1] >= WINDOW_MS) hits.delete(k);
  }
  return ok;
}

module.exports = { allow, LIMIT, WINDOW_MS, reset: () => hits.clear() };

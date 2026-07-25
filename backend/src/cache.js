// Кэш в памяти процесса для справочных данных (категории, города, счётчики).
// База лежит в другом регионе, и каждый поход к ней стоит сотни миллисекунд,
// а эти списки меняются редко — держать их в памяти дешевле всего.
const store = new Map();

// Кладём в кэш само промис, а не результат: если во время загрузки прилетит
// ещё десяток запросов, они дождутся того же запроса, а не устроят свой каждый.
function cached(key, ttlMs, loader) {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const value = Promise.resolve()
    .then(loader)
    .catch((err) => {
      store.delete(key); // неудачу не кэшируем — следующий запрос попробует снова
      throw err;
    });

  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

// Сбрасывает всё, что начинается с префикса (например, после правки категорий)
function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

module.exports = { cached, invalidate };

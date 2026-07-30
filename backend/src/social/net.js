// «fetch failed» на бесплатном Render — обычное дело: исходящее соединение к
// серверам Meta иногда обрывается на установке, и тот же самый запрос через
// несколько секунд проходит. Отличать такое от отказа API важно: сетевой сбой
// надо повторять, а «токен протух» или «ролик слишком длинный» — не надо,
// повтор только потратит время.
const NETWORK_ERROR =
  /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|terminated|timeout/i;

function isNetworkError(err) {
  return NETWORK_ERROR.test((err && err.message) || '');
}

// Два кода Meta называет временными сама: 1 (API Unknown) и 2 (API Service).
// Наружу они выходят как «An unknown error occurred» — строка, по которой не
// понять ничего, но тот же запрос через несколько секунд проходит. Остальные
// отказы окончательные: протухший токен от повтора не оживёт.
const TRANSIENT_CODES = new Set([1, 2]);

function isTransientApiError(err) {
  return TRANSIENT_CODES.has(err && err.code);
}

const isRetryable = (err) => isNetworkError(err) || isTransientApiError(err);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Повторяет запрос, пока он падает по сети. Всё остальное отдаёт наверх сразу:
// на ответ самого API повтор ничего не изменит — если вызывающий не скажет
// отдельно, что именно считать поводом для повтора.
async function withRetry(label, attempts, fn, retryable = isNetworkError) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !retryable(err)) throw err;
      console.log(`[${label}] не прошло (${err.message}) — попытка ${attempt + 1} из ${attempts}`);
      await sleep(2000 * attempt);
    }
  }
}

module.exports = { sleep, isNetworkError, isTransientApiError, isRetryable, withRetry };

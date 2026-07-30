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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Повторяет запрос, пока он падает по сети. Всё остальное отдаёт наверх сразу:
// на ответ самого API повтор ничего не изменит.
async function withRetry(label, attempts, fn) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts || !isNetworkError(err)) throw err;
      console.log(`[${label}] сеть отвалилась (${err.message}) — попытка ${attempt + 1} из ${attempts}`);
      await sleep(2000 * attempt);
    }
  }
}

module.exports = { sleep, isNetworkError, withRetry };

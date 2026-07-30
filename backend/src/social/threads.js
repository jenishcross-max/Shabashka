// Публикация в Threads — текстовым постом, без ролика (см. publishText).
// API отдельное от инстаграмного: свой хост, свой идентификатор профиля и свой
// токен, даже если аккаунт Threads заведён на том же Instagram.
const { sleep, isNetworkError, withRetry } = require('./net');

const USER_ID = process.env.THREADS_USER_ID || '';
const TOKEN = process.env.THREADS_ACCESS_TOKEN || '';
const HOST = 'graph.threads.net';
const VERSION = 'v1.0';

// Пауза перед повторной проверкой контейнера при сетевом сбое публикации
// (см. publishContainer) — не связана с обработкой ролика, его больше нет.
const RETRY_CHECK_DELAY_MS = 5000;

function isConfigured() {
  return Boolean(USER_ID && TOKEN);
}

async function call(method, path, params) {
  const url = new URL(`https://${HOST}/${VERSION}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: TOKEN });

  const res = await fetch(method === 'GET' ? `${url}?${body}` : url, {
    method,
    body: method === 'GET' ? undefined : body,
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Threads: ${(data.error && data.error.message) || res.status}`);
  }
  return data;
}

// Всё, кроме самой публикации, повторяем при сетевом сбое: наружу эти запросы
// ничего не выкладывают.
const safeCall = (method, path, params) => withRetry('threads', 3, () => call(method, path, params));

function statusOf(creationId) {
  return safeCall('GET', creationId, { fields: 'status,error_message' });
}

// Повтор публикации мог бы выложить второй такой же пост, поэтому на сетевом
// сбое сначала смотрим, не опубликовался ли контейнер с первого раза.
async function publishContainer(creationId) {
  try {
    const { id } = await call('POST', `${USER_ID}/threads_publish`, { creation_id: creationId });
    return id;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    console.log(`[threads] публикация оборвалась (${err.message}) — проверяю контейнер`);
    await sleep(RETRY_CHECK_DELAY_MS);
    if ((await statusOf(creationId)).status === 'PUBLISHED') {
      console.log(`[threads] пост всё-таки опубликован (контейнер ${creationId})`);
      return creationId;
    }
    const { id } = await call('POST', `${USER_ID}/threads_publish`, { creation_id: creationId });
    return id;
  }
}

// Ссылка в тексте здесь кликабельная — в отличие от Instagram, поэтому текст
// для Threads собирается свой, с адресом объявления (см. video.threadsText).
// Контейнер с media_type TEXT ничего не кодирует, статус проверять незачем —
// можно публиковать сразу же.
async function publishText(text) {
  const { id } = await safeCall('POST', `${USER_ID}/threads`, {
    media_type: 'TEXT',
    text,
  });
  return publishContainer(id);
}

module.exports = { isConfigured, publishText };

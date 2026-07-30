// Публикация в Threads. Порядок тот же, что у Instagram: контейнер → Threads
// сам скачивает ролик по ссылке и кодирует его → публикация готового контейнера.
// API отдельное от инстаграмного: свой хост, свой идентификатор профиля и свой
// токен, даже если аккаунт Threads заведён на том же Instagram.
const { sleep, isNetworkError, withRetry } = require('./net');

const USER_ID = process.env.THREADS_USER_ID || '';
const TOKEN = process.env.THREADS_ACCESS_TOKEN || '';
const HOST = 'graph.threads.net';
const VERSION = 'v1.0';

// Meta советует давать роликам около 30 секунд на обработку. Опрашиваем статус
// вместо глухого ожидания: девятисекундный ролик обычно готов раньше.
const POLL_INTERVAL_MS = 5000;
const POLL_ATTEMPTS = 24;

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

async function waitReady(creationId) {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const { status, error_message: error } = await statusOf(creationId);
    console.log(`[threads] статус ролика ${creationId}: ${status}`);
    if (status === 'FINISHED' || status === 'PUBLISHED') return status;
    if (status === 'ERROR' || status === 'EXPIRED') {
      // error_message у Threads конкретный (INVALID_DURATION, FAILED_PROCESSING_AUDIO)
      // — без него по одному ERROR не понять, чинить ролик или ждать.
      throw new Error(`Threads не смог обработать ролик (${error || status})`);
    }
  }
  throw new Error('Threads слишком долго обрабатывает ролик');
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
    await sleep(POLL_INTERVAL_MS);
    if ((await statusOf(creationId)).status === 'PUBLISHED') {
      console.log(`[threads] пост всё-таки опубликован (контейнер ${creationId})`);
      return creationId;
    }
    const { id } = await call('POST', `${USER_ID}/threads_publish`, { creation_id: creationId });
    return id;
  }
}

// videoUrl должен быть доступен снаружи: Threads приходит за роликом со своих
// серверов. Ссылка в тексте здесь кликабельная — в отличие от Instagram,
// поэтому текст для Threads собирается свой, с адресом объявления.
async function publishReel(videoUrl, text) {
  const { id } = await safeCall('POST', `${USER_ID}/threads`, {
    media_type: 'VIDEO',
    video_url: videoUrl,
    text,
  });
  if ((await waitReady(id)) === 'PUBLISHED') return id;
  return publishContainer(id);
}

module.exports = { isConfigured, publishReel };

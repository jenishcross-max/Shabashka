// Публикация в Threads — текстовым постом, без ролика (см. publishText).
// API отдельное от инстаграмного: свой хост, свой идентификатор профиля и свой
// токен, даже если аккаунт Threads заведён на том же Instagram.
const { sleep, isRetryable, withRetry } = require('./net');

const USER_ID = process.env.THREADS_USER_ID || '';
const TOKEN = process.env.THREADS_ACCESS_TOKEN || '';
const HOST = 'graph.threads.net';
const VERSION = 'v1.0';

// Пауза перед повторной проверкой контейнера при сорвавшейся публикации
// (см. publishContainer) — не связана с обработкой ролика, его больше нет.
const RETRY_CHECK_DELAY_MS = 5000;

// Meta просит подождать, прежде чем публиковать контейнер. Текстовый пост почти
// всегда готов сразу, поэтому не спим фиксированные полминуты, а спрашиваем
// статус: обычно это один лишний вызов, а не потерянная минута.
const STATUS_INTERVAL_MS = 5000;
const STATUS_ATTEMPTS = 6;

function isConfigured() {
  return Boolean(USER_ID && TOKEN);
}

// step — что именно делали: Meta на половину отказов отвечает «An unknown error
// occurred» и больше ничем, и такую строку без шага, кода и трейса не с чем
// сопоставить. fbtrace_id — единственное, по чему Meta потом найдёт сам запрос.
async function call(step, method, path, params) {
  const url = new URL(`https://${HOST}/${VERSION}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: TOKEN });

  const res = await fetch(method === 'GET' ? `${url}?${body}` : url, {
    method,
    body: method === 'GET' ? undefined : body,
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const e = data.error || {};
    const detail = [
      e.code ? `код ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''}` : '',
      e.fbtrace_id ? `трейс ${e.fbtrace_id}` : '',
    ].filter(Boolean);
    const err = new Error(
      `${step}: ${e.error_user_msg || e.message || res.status}${detail.length ? ` (${detail.join(', ')})` : ''}`
    );
    // По коду решаем, повторять ли: см. isTransientApiError в net.js.
    err.code = e.code;
    err.subcode = e.error_subcode;
    throw err;
  }
  return data;
}

// Всё, кроме самой публикации, повторяем сразу: наружу эти запросы ничего не
// выкладывают, так что и сетевой обрыв, и временный отказ Meta здесь безобидны.
const safeCall = (step, method, path, params) =>
  withRetry('threads', 3, () => call(step, method, path, params), isRetryable);

function statusOf(creationId) {
  return safeCall('статус поста', 'GET', creationId, { fields: 'status,error_message' });
}

// Ждём, пока контейнер станет FINISHED. Публикация неготового отвечает тем же
// «An unknown error occurred», то есть ничем.
async function waitReady(creationId) {
  for (let i = 0; i < STATUS_ATTEMPTS; i += 1) {
    let status;
    let message;
    try {
      ({ status, error_message: message } = await statusOf(creationId));
    } catch (err) {
      // Статус — вспомогательный запрос. Не ответил — публикуем как раньше,
      // сразу: отказаться от поста из-за неудачной проверки было бы хуже.
      console.log(`[threads] статус контейнера ${creationId} не узнать (${err.message})`);
      return 'UNKNOWN';
    }
    console.log(`[threads] контейнер ${creationId}: ${status}`);
    if (status === 'FINISHED' || status === 'PUBLISHED') return status;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`пост не принят (${status}${message ? `: ${message}` : ''})`);
    }
    await sleep(STATUS_INTERVAL_MS);
  }
  throw new Error('пост слишком долго готовится');
}

// Повтор публикации мог бы выложить второй такой же пост, поэтому перед ним
// сначала смотрим, не опубликовался ли контейнер с первого раза.
async function publishContainer(creationId) {
  try {
    const { id } = await call('публикация', 'POST', `${USER_ID}/threads_publish`, { creation_id: creationId });
    return id;
  } catch (err) {
    if (!isRetryable(err)) throw err;
    console.log(`[threads] публикация не прошла (${err.message}) — проверяю контейнер`);
    await sleep(RETRY_CHECK_DELAY_MS);
    if ((await statusOf(creationId)).status === 'PUBLISHED') {
      console.log(`[threads] пост всё-таки опубликован (контейнер ${creationId})`);
      return creationId;
    }
    const { id } = await call('публикация', 'POST', `${USER_ID}/threads_publish`, { creation_id: creationId });
    return id;
  }
}

// Ссылка в тексте здесь кликабельная — в отличие от Instagram, поэтому текст
// для Threads собирается свой, с адресом объявления (см. video.threadsText).
async function publishText(text) {
  const { id } = await safeCall('создание поста', 'POST', `${USER_ID}/threads`, {
    media_type: 'TEXT',
    text,
  });
  if ((await waitReady(id)) === 'PUBLISHED') return id;
  return publishContainer(id);
}

module.exports = { isConfigured, publishText };

// Публикация Reels через Instagram Graph API. Три шага, иначе никак: сначала
// создаётся контейнер, Instagram сам скачивает ролик по ссылке и кодирует его,
// и только готовый контейнер можно опубликовать.
const { sleep, isNetworkError, withRetry } = require('./net');

const USER_ID = process.env.INSTAGRAM_USER_ID || '';
const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || '';
// graph.instagram.com — вариант «Instagram API with Instagram Login»: заводится
// на самом аккаунте, без страницы в Facebook. Кому нужен доступ через Facebook
// Login, тот ставит graph.facebook.com в этой переменной.
const HOST = process.env.INSTAGRAM_GRAPH_HOST || 'graph.instagram.com';
const VERSION = 'v23.0';

const POLL_INTERVAL_MS = 5000;
const POLL_ATTEMPTS = 24; // ~2 минуты: столько Instagram может кодировать ролик

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
    throw new Error(`Instagram: ${(data.error && data.error.message) || res.status}`);
  }
  return data;
}

// Создание контейнера и опрос статуса можно повторять сколько угодно: ничего
// наружу они не публикуют, так что оборванное соединение здесь ничем не грозит.
const safeCall = (method, path, params) => withRetry('insta', 3, () => call(method, path, params));

function status(creationId) {
  return safeCall('GET', creationId, { fields: 'status_code' }).then((d) => d.status_code);
}

async function waitReady(creationId) {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const code = await status(creationId);
    console.log(`[insta] статус ролика ${creationId}: ${code}`);
    // PUBLISHED — если публикация уже прошла в предыдущей, оборвавшейся попытке
    if (code === 'FINISHED' || code === 'PUBLISHED') return code;
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new Error(`Instagram не смог обработать ролик (${code})`);
    }
  }
  throw new Error('Instagram слишком долго обрабатывает ролик');
}

// Единственный шаг, который нельзя повторять слепо: если запрос до Instagram
// дошёл, а ответ потерялся по дороге, второй такой же запрос выложит второй
// ролик. Поэтому на сетевом сбое сначала спрашиваем контейнер, не опубликован
// ли он уже, и повторяем только если нет.
async function publishContainer(creationId) {
  try {
    const { id } = await call('POST', `${USER_ID}/media_publish`, { creation_id: creationId });
    return id;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    console.log(`[insta] публикация оборвалась (${err.message}) — проверяю контейнер`);
    await sleep(POLL_INTERVAL_MS);
    if ((await status(creationId)) === 'PUBLISHED') {
      console.log(`[insta] ролик всё-таки опубликован (контейнер ${creationId})`);
      return creationId;
    }
    const { id } = await call('POST', `${USER_ID}/media_publish`, { creation_id: creationId });
    return id;
  }
}

// videoUrl должен быть публично доступен — Instagram ходит за ним со своих
// серверов, локальный адрес или закрытый бэкенд он не откроет.
// thumbOffsetMs — с какой миллисекунды взять картинку для сетки профиля. Без
// него Instagram берёт первый кадр, а объявление к тому моменту ещё не выехало.
async function publishReel(videoUrl, caption, thumbOffsetMs) {
  const { id } = await safeCall('POST', `${USER_ID}/media`, {
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
    ...(thumbOffsetMs ? { thumb_offset: String(thumbOffsetMs) } : {}),
  });
  if ((await waitReady(id)) === 'PUBLISHED') return id;
  return publishContainer(id);
}

module.exports = { isConfigured, publishReel };

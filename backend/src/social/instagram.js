// Публикация Reels через Instagram Graph API. Три шага, иначе никак: сначала
// создаётся контейнер, Instagram сам скачивает ролик по ссылке и кодирует его,
// и только готовый контейнер можно опубликовать.
const { sleep, isRetryable, withRetry } = require('./net');

const USER_ID = process.env.INSTAGRAM_USER_ID || '';
const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || '';
// graph.instagram.com — вариант «Instagram API with Instagram Login»: заводится
// на самом аккаунте, без страницы в Facebook. Кому нужен доступ через Facebook
// Login, тот ставит graph.facebook.com в этой переменной.
const HOST = process.env.INSTAGRAM_GRAPH_HOST || 'graph.instagram.com';
const VERSION = 'v23.0';

// Каждый опрос статуса — отдельный вызов Graph API, а они считаются в тот же
// часовой лимит приложения, что и публикация. Реже опрашиваем — тот же запас
// времени на кодирование (~2 минуты), но заметно меньше вызовов на ролик.
const POLL_INTERVAL_MS = 8000;
const POLL_ATTEMPTS = 15;

function isConfigured() {
  return Boolean(USER_ID && TOKEN);
}

// step — что именно делали. Без него в чат уходит одна строка от Meta, а она
// сплошь и рядом «An unknown error occurred»: по такой не понять ни этапа, ни
// причины. Код нужен, чтобы решать, повторять ли (см. net.js), а fbtrace_id —
// единственное, по чему Meta потом найдёт сам запрос.
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
    err.code = e.code;
    err.subcode = e.error_subcode;
    throw err;
  }
  return data;
}

// Создание контейнера и опрос статуса можно повторять сколько угодно: ничего
// наружу они не публикуют, так что и оборванное соединение, и временный отказ
// Meta здесь ничем не грозят.
const safeCall = (step, method, path, params) =>
  withRetry('insta', 3, () => call(step, method, path, params), isRetryable);

function status(creationId) {
  return safeCall('статус ролика', 'GET', creationId, { fields: 'status_code' }).then((d) => d.status_code);
}

async function waitReady(creationId) {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const code = await status(creationId);
    console.log(`[insta] статус ролика ${creationId}: ${code}`);
    // PUBLISHED — если публикация уже прошла в предыдущей, оборвавшейся попытке
    if (code === 'FINISHED' || code === 'PUBLISHED') return code;
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new Error(`ролик не обработан (${code})`);
    }
  }
  throw new Error('ролик слишком долго обрабатывается');
}

// Единственный шаг, который нельзя повторять слепо: если запрос до Instagram
// дошёл, а ответ потерялся по дороге, второй такой же запрос выложит второй
// ролик. Поэтому на сетевом сбое сначала спрашиваем контейнер, не опубликован
// ли он уже, и повторяем только если нет.
async function publishContainer(creationId) {
  try {
    const { id } = await call('публикация', 'POST', `${USER_ID}/media_publish`, { creation_id: creationId });
    return id;
  } catch (err) {
    if (!isRetryable(err)) throw err;
    console.log(`[insta] публикация не прошла (${err.message}) — проверяю контейнер`);
    await sleep(POLL_INTERVAL_MS);
    if ((await status(creationId)) === 'PUBLISHED') {
      console.log(`[insta] ролик всё-таки опубликован (контейнер ${creationId})`);
      return creationId;
    }
    const { id } = await call('публикация', 'POST', `${USER_ID}/media_publish`, { creation_id: creationId });
    return id;
  }
}

// videoUrl должен быть публично доступен — Instagram ходит за ним со своих
// серверов, локальный адрес или закрытый бэкенд он не откроет.
// thumbOffsetMs — с какой миллисекунды взять картинку для сетки профиля. Без
// него Instagram берёт первый кадр, а объявление к тому моменту ещё не выехало.
async function publishReel(videoUrl, caption, thumbOffsetMs) {
  const { id } = await safeCall('создание ролика', 'POST', `${USER_ID}/media`, {
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
    ...(thumbOffsetMs ? { thumb_offset: String(thumbOffsetMs) } : {}),
  });
  if ((await waitReady(id)) === 'PUBLISHED') return id;
  return publishContainer(id);
}

// Обычный пост картинкой — запасной ход, когда ролик не доехал (см.
// withImageFallback в index.js). Шагов здесь два, а не три: кодировать нечего,
// контейнер с картинкой Instagram отдаёт готовым, и опрашивать статус незачем.
// Отсюда и весь смысл запасного хода — картинка проходит там, где ролик
// спотыкается о сборку или обработку.
async function publishImage(imageUrl, caption) {
  const { id } = await safeCall('создание поста', 'POST', `${USER_ID}/media`, {
    image_url: imageUrl,
    caption,
  });
  return publishContainer(id);
}

// Сколько публикаций за скользящие сутки уже потрачено и сколько их всего
// положено. Считает это Instagram у себя и по аккаунту — вместе с постами,
// сделанными руками из приложения, и вместе с неудачными попытками. Свой
// счётчик в памяти процесса такого знать не может, поэтому число отсюда всегда
// вернее (см. sync в quota.js).
async function publishingLimit() {
  const { data } = await safeCall('норма публикаций', 'GET', `${USER_ID}/content_publishing_limit`, {
    fields: 'config,quota_usage',
  });
  const row = (data && data[0]) || {};
  return {
    used: Number(row.quota_usage) || 0,
    total: Number(row.config && row.config.quota_total) || 0,
  };
}

// Число подписчиков — для бейджа на главной. Тот же токен и тот же часовой
// лимит Graph API, что и у публикации, поэтому вызывать часто нельзя — кэш
// на стороне вызывающего кода должен быть в десятки минут, не в секунды.
async function followers() {
  const { followers_count } = await safeCall('подписчики', 'GET', USER_ID, {
    fields: 'followers_count',
  });
  return followers_count;
}

module.exports = { isConfigured, publishReel, publishImage, publishingLimit, followers };

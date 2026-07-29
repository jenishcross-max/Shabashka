// Публикация Reels через Instagram Graph API. Три шага, иначе никак: сначала
// создаётся контейнер, Instagram сам скачивает ролик по ссылке и кодирует его,
// и только готовый контейнер можно опубликовать.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(creationId) {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS);
    const { status_code: status } = await call('GET', creationId, { fields: 'status_code' });
    console.log(`[insta] статус ролика ${creationId}: ${status}`);
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`Instagram не смог обработать ролик (${status})`);
    }
  }
  throw new Error('Instagram слишком долго обрабатывает ролик');
}

// videoUrl должен быть публично доступен — Instagram ходит за ним со своих
// серверов, локальный адрес или закрытый бэкенд он не откроет.
async function publishReel(videoUrl, caption) {
  const { id } = await call('POST', `${USER_ID}/media`, {
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
  });
  await waitReady(id);
  const published = await call('POST', `${USER_ID}/media_publish`, { creation_id: id });
  return published.id;
}

module.exports = { isConfigured, publishReel };

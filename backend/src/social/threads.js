// Публикация в Threads и всё, что вокруг неё: картинки и видео рекламы,
// статистика постов для отчёта рекламодателю, ответы под постами.
// API отдельное от инстаграмного: свой хост, свой идентификатор профиля и свой
// токен, даже если аккаунт Threads заведён на том же Instagram.
const { sleep, isRetryable, withRetry, TIMEOUT_MS } = require('./net');
const tokens = require('./tokens');

const USER_ID = process.env.THREADS_USER_ID || '';
const HOST = 'graph.threads.net';
const VERSION = 'v1.0';

// Пауза перед повторной проверкой контейнера при сорвавшейся публикации
// (см. publishContainer).
const RETRY_CHECK_DELAY_MS = 5000;

// Meta просит подождать, прежде чем публиковать контейнер. Текстовый пост почти
// всегда готов сразу, поэтому не спим фиксированные полминуты, а спрашиваем
// статус: обычно это один лишний вызов, а не потерянная минута. Картинке нужно
// чуть больше, видео — заметно больше: Meta его перекодирует у себя.
const STATUS_INTERVAL_MS = 5000;
const STATUS_ATTEMPTS = { TEXT: 6, IMAGE: 12, VIDEO: 36 };

// Тег темы у Threads один на пост — второй и дальше в тексте становятся просто
// словами с решёткой. Так и выглядели наши посты: «шабашка #вакансиибишкек
// #жумуш», где первое слово стало тегом, а остальное осталось хвостом, который
// только занимал место у описания. Теперь тег уходит отдельным полем, а текст
// остаётся чистым. Ограничения Meta: от 1 до 50 знаков, без точки и амперсанда.
function cleanTag(tag) {
  const clean = String(tag || '')
    .replace(/^#+/, '')
    .replace(/[.&]/g, '')
    .trim()
    .slice(0, 50);
  return clean || '';
}

function isConfigured() {
  return Boolean(USER_ID && tokens.get('threads'));
}

// Отказ по правам: у токена нет нужного разрешения (threads_manage_insights,
// threads_read_replies). Повторять такое бесполезно, а сказать об этом админу
// надо один раз и понятными словами — см. permissionHint.
function isPermissionError(err) {
  return Boolean(err) && (err.code === 10 || err.code === 200 || /permission/i.test(err.message || ''));
}

// step — что именно делали: Meta на половину отказов отвечает «An unknown error
// occurred» и больше ничем, и такую строку без шага, кода и трейса не с чем
// сопоставить. fbtrace_id — единственное, по чему Meta потом найдёт сам запрос.
async function call(step, method, path, params) {
  const url = new URL(`https://${HOST}/${VERSION}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: tokens.get('threads') });

  // Токен и параметры у DELETE идут строкой запроса, как у GET: тела у него нет.
  const inUrl = method === 'GET' || method === 'DELETE';
  const res = await fetch(inUrl ? `${url}?${body}` : url, {
    method,
    body: inUrl ? undefined : body,
    // Срок нужен, чтобы зависший запрос не держал очередь постов (см. net.js).
    signal: AbortSignal.timeout(TIMEOUT_MS),
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
    err.permission = isPermissionError(err);
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
async function waitReady(creationId, attempts) {
  for (let i = 0; i < attempts; i += 1) {
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

// Общий путь всех трёх видов поста: контейнер, ожидание, публикация.
async function publish(mediaType, fields, { topicTag } = {}) {
  const tag = cleanTag(topicTag);
  const { id } = await safeCall('создание поста', 'POST', `${USER_ID}/threads`, {
    media_type: mediaType,
    ...fields,
    ...(tag ? { topic_tag: tag } : {}),
  });
  if ((await waitReady(id, STATUS_ATTEMPTS[mediaType])) === 'PUBLISHED') return id;
  return publishContainer(id);
}

// Ссылка в тексте здесь кликабельная — в отличие от Instagram, поэтому текст
// для Threads собирается свой, с адресом объявления (см. video.threadsText).
function publishText(text, opts) {
  return publish('TEXT', { text }, opts);
}

// Пост с картинкой. Для рекламы это сама её суть: рекламодатель платит за то,
// чтобы его заметили в ленте, а картинку в ленте замечают раньше текста. Threads
// приходит за файлом сам, по ссылке, — как и Instagram (см. hosting.js).
function publishImage(imageUrl, text, opts) {
  return publish('IMAGE', { image_url: imageUrl, ...(text ? { text } : {}) }, opts);
}

// Ролик рекламодателя — тем же путём, только ждать дольше: Meta его перекодирует.
function publishVideo(videoUrl, text, opts) {
  return publish('VIDEO', { video_url: videoUrl, ...(text ? { text } : {}) }, opts);
}

// Снимает пост. Нужно, когда автор объявления нашёл работника и попросил убрать
// его: на сайте карточку удаляем сами, а пост в Threads без этого висел бы
// дальше и приводил людей к закрытой вакансии.
//
// Своя норма у удалений — сотня в сутки, отдельно от нормы на публикации. Нам её
// не выбрать: столько объявлений за день и не выходит.
async function remove(postId) {
  await safeCall('удаление поста', 'DELETE', String(postId), {});
}

// Своя норма у Threads считается отдельно от инстаграмной и заметно щедрее —
// 250 постов за скользящие сутки против сотни. Сюда ходим только по команде
// /limits: коду это число не нужно, публикации в Threads в него не упираются.
async function publishingLimit() {
  const { data } = await safeCall('норма публикаций', 'GET', `${USER_ID}/threads_publishing_limit`, {
    fields: 'quota_usage,config',
  });
  const row = (data && data[0]) || {};
  return {
    used: Number(row.quota_usage) || 0,
    total: Number(row.config && row.config.quota_total) || 0,
  };
}

// Из ответа insights — число по имени метрики. У метрик поста значение лежит в
// values[0].value, у метрик аккаунта — в total_value.value, а просмотры
// аккаунта приходят рядом значений по дням, и их надо сложить.
function metric(data, name) {
  const row = (data || []).find((item) => item.name === name);
  if (!row) return null;
  if (row.total_value && Number.isFinite(Number(row.total_value.value))) return Number(row.total_value.value);
  const values = Array.isArray(row.values) ? row.values : [];
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + (Number(v.value) || 0), 0);
}

const POST_METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'];

// Статистика одного поста — то, что рекламодатель получает в отчёте. Нужно
// разрешение threads_manage_insights; без него Meta отвечает кодом 10, и об
// этом скажет вызывающий (см. isPermissionError).
async function insights(mediaId) {
  const { data } = await safeCall('статистика поста', 'GET', `${mediaId}/insights`, {
    metric: POST_METRICS.join(','),
  });
  return Object.fromEntries(POST_METRICS.map((name) => [name, metric(data, name) || 0]));
}

// Ссылка на пост. Из числового id её не собрать: в адресе стоит shortcode,
// который знает только Meta.
async function permalink(mediaId) {
  const { permalink: link } = await safeCall('ссылка на пост', 'GET', String(mediaId), { fields: 'permalink' });
  return link || '';
}

// Статистика аккаунта за период — для /threads: сколько просмотров набирает
// лента. Этими числами и продаётся реклама. since/until — в секундах Unix.
async function accountInsights({ since, until }) {
  const { data } = await safeCall('статистика аккаунта', 'GET', `${USER_ID}/threads_insights`, {
    metric: 'views,likes,replies,reposts,quotes',
    since: String(since),
    until: String(until),
  });
  // Подписчиков Meta за период не отдаёт — только число на сейчас, отдельным
  // запросом без дат.
  let followers = null;
  try {
    const res = await safeCall('подписчики Threads', 'GET', `${USER_ID}/threads_insights`, {
      metric: 'followers_count',
    });
    followers = metric(res.data, 'followers_count');
  } catch (err) {
    console.log(`[threads] подписчиков не узнать (${err.message})`);
  }
  return {
    views: metric(data, 'views') || 0,
    likes: metric(data, 'likes') || 0,
    replies: metric(data, 'replies') || 0,
    reposts: metric(data, 'reposts') || 0,
    quotes: metric(data, 'quotes') || 0,
    followers,
  };
}

// Свои последние посты — для просмотра ответов под ними (см. leads.js).
async function recentPosts(limit = 15) {
  const { data } = await safeCall('свои посты', 'GET', `${USER_ID}/threads`, {
    fields: 'id,timestamp,permalink',
    limit: String(limit),
  });
  return (data || []).map((post) => ({
    id: post.id,
    at: Date.parse(post.timestamp) || 0,
    permalink: post.permalink || '',
  }));
}

// Ответы под постом. Нужно разрешение threads_read_replies.
async function replies(mediaId) {
  const { data } = await safeCall('ответы под постом', 'GET', `${mediaId}/replies`, {
    fields: 'id,text,username,timestamp,permalink,is_reply_owned_by_me',
    reverse: 'false',
  });
  return (data || []).map((reply) => ({
    id: reply.id,
    text: reply.text || '',
    username: reply.username || '',
    // Свой ответ заявкой не бывает: админ под постом пишет «реклама — 50 сом»,
    // и без этой пометки бот присылал бы его же слова как чужой вопрос.
    mine: Boolean(reply.is_reply_owned_by_me),
    at: Date.parse(reply.timestamp) || 0,
    permalink: reply.permalink || '',
  }));
}

module.exports = {
  isConfigured,
  isPermissionError,
  cleanTag,
  publishText,
  publishImage,
  publishVideo,
  publishingLimit,
  remove,
  insights,
  permalink,
  accountInsights,
  recentPosts,
  replies,
  metric,
};

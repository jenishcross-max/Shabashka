// Обёртка над Threads API и починка Instagram (см. src/social/threads.js и
// src/social/instagram.js). Здесь — то, что видно только по самим запросам:
// тег темы уходит отдельным полем, картинка публикуется через контейнер с
// ожиданием, статистика поста разбирается из ответа Meta, а Instagram больше
// не бросает пост на «media is not ready», которое проходит само за секунды.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');

process.env.THREADS_USER_ID = '111';
process.env.INSTAGRAM_USER_ID = '222';
process.env.INSTAGRAM_ACCESS_TOKEN = 'ig';

// Паузы между опросами статуса — секунды; в тесте они ни к чему.
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 1000 ? 1 : ms, ...rest);

const requireSrc = install({
  [at('social/tokens.js')]: { get: (platform) => (platform === 'threads' ? 'th' : 'ig') },
});

const calls = [];
let respond = () => ({});
global.fetch = async (url, options = {}) => {
  const u = new URL(String(url));
  const params = Object.fromEntries(
    options.body ? new URLSearchParams(String(options.body)) : u.searchParams
  );
  calls.push({ method: options.method || 'GET', path: u.pathname, params });
  const { status = 200, body = {} } = respond(u.pathname, params) || {};
  return { ok: status < 400, status, json: async () => body };
};

const threads = requireSrc('social/threads.js');
const instagram = requireSrc('social/instagram.js');

test('тег темы уходит отдельным полем и очищается под правила Meta', async () => {
  calls.length = 0;
  respond = (p) => {
    if (p.endsWith('/111/threads')) return { body: { id: 'c1' } };
    if (p.endsWith('/c1')) return { body: { status: 'FINISHED' } };
    if (p.endsWith('/threads_publish')) return { body: { id: 'post1' } };
    return {};
  };
  const id = await threads.publishText('текст объявления', { topicTag: '#шабашка.бишкек&' });
  assert.equal(id, 'post1');
  const create = calls.find((c) => c.path.endsWith('/111/threads'));
  assert.equal(create.params.media_type, 'TEXT');
  assert.equal(create.params.topic_tag, 'шабашкабишкек', 'без решётки, точки и амперсанда');
  assert.equal(create.params.access_token, 'th', 'токен — из хранилища, а не прямо из окружения');
});

test('пустой тег не отправляется вовсе', async () => {
  calls.length = 0;
  await threads.publishText('текст', { topicTag: '' });
  assert.equal(calls.find((c) => c.path.endsWith('/111/threads')).params.topic_tag, undefined);
});

test('картинка — контейнер IMAGE с адресом файла и подписью', async () => {
  calls.length = 0;
  await threads.publishImage('https://x.test/api/social/image/a.jpg', 'подпись', { topicTag: 'шабашка' });
  const create = calls.find((c) => c.path.endsWith('/111/threads'));
  assert.equal(create.params.media_type, 'IMAGE');
  assert.equal(create.params.image_url, 'https://x.test/api/social/image/a.jpg');
  assert.equal(create.params.text, 'подпись');
  assert.ok(calls.some((c) => c.path.endsWith('/threads_publish')), 'и опубликован');
});

test('видео ждёт обработки, пока Meta не скажет FINISHED', async () => {
  calls.length = 0;
  let polls = 0;
  respond = (p) => {
    if (p.endsWith('/111/threads')) return { body: { id: 'v1' } };
    if (p.endsWith('/v1')) {
      polls += 1;
      return { body: { status: polls < 4 ? 'IN_PROGRESS' : 'FINISHED' } };
    }
    if (p.endsWith('/threads_publish')) return { body: { id: 'post-v' } };
    return {};
  };
  assert.equal(await threads.publishVideo('https://x.test/v.mp4', 'ролик'), 'post-v');
  assert.equal(polls, 4);
});

test('статистика поста разбирается из ответа Meta', async () => {
  respond = (p) =>
    p.endsWith('/insights')
      ? {
          body: {
            data: [
              { name: 'views', values: [{ value: 1842 }] },
              { name: 'likes', values: [{ value: 12 }] },
              { name: 'replies', values: [{ value: 3 }] },
              { name: 'reposts', values: [{ value: 2 }] },
            ],
          },
        }
      : {};
  const stats = await threads.insights('post1');
  assert.deepEqual(stats, { views: 1842, likes: 12, replies: 3, reposts: 2, quotes: 0, shares: 0 });
});

test('просмотры аккаунта — сумма по дням, подписчики — отдельным числом', async () => {
  respond = (p, params) => {
    if (!p.endsWith('/threads_insights')) return {};
    if (params.metric === 'followers_count') {
      return { body: { data: [{ name: 'followers_count', total_value: { value: 3768 } }] } };
    }
    return {
      body: {
        data: [
          { name: 'views', values: [{ value: 60000 }, { value: 65000 }] },
          { name: 'likes', total_value: { value: 400 } },
        ],
      },
    };
  };
  const week = await threads.accountInsights({ since: 1, until: 2 });
  assert.equal(week.views, 125000);
  assert.equal(week.likes, 400);
  assert.equal(week.followers, 3768);
});

test('отказ по правам помечается — его не повторяют, а объясняют', async () => {
  respond = () => ({ status: 403, body: { error: { message: 'Application does not have permission', code: 10 } } });
  await assert.rejects(
    () => threads.insights('post1'),
    (err) => err.permission === true
  );
});

test('Instagram: «media is not ready» пережидается, а не уходит в повторы на часы', async () => {
  calls.length = 0;
  let publishes = 0;
  respond = (p) => {
    if (p.endsWith('/222/media')) return { body: { id: 'ic1' } };
    if (p.endsWith('/media_publish')) {
      publishes += 1;
      return publishes < 3
        ? {
            status: 400,
            body: {
              error: {
                message: 'The media is not ready for publishing, please wait for a moment',
                code: 9007,
                error_subcode: 2207027,
              },
            },
          }
        : { body: { id: 'ig-post' } };
    }
    return {};
  };
  assert.equal(await instagram.publishImage('https://x.test/i.jpg', 'подпись'), 'ig-post');
  assert.equal(publishes, 3, 'две неудачи «не готов» и успех');
});

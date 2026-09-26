const db = require('../db');
const threads = require('./threads');

// Заявки на рекламу из ответов в Threads.
//
// Рекламу у Шабашки заказывают в Threads, и часть заказов начинается прямо под
// постами: «сколько стоит реклама?», «как у вас разместить?». В потоке из
// десятков ответов на вакансии («номер?», «ещё актуально?») такой вопрос
// теряется, а за ним — деньги. Бот раз в полчаса смотрит ответы под свежими
// постами и присылает админу только те, где спрашивают про рекламу.
//
// Личные сообщения Threads через API не отдаёт вовсе — их смотреть по-прежнему
// в приложении.

// Про рекламу: «реклама», «жарнама», «разместить», «прайс», «сотрудничество».
// Слова про цену сами по себе не годятся: под вакансиями спрашивают
// «сколько платят?» десятками, и каждый такой ответ был бы ложной тревогой.
const AD_INTENT =
  /реклам|жарнам|размест|подать объявлен|подать своё объявлен|опубликуй(те)? (мо|наш)|выложи(те)? (мо|наш)|прайс|сотрудничеств|как к вам попасть|как у вас попасть/i;

const CHECK_EVERY_MS = 30 * 60 * 1000;
// Сколько своих последних постов просматривать. Поста раз в десять минут —
// пятнадцать это два с половиной часа ленты; под старыми постами пишут редко,
// а на каждый пост уходит отдельный вызов API.
const RECENT_POSTS = 15;
// Под рекламой смотрим дольше — там вопросы про рекламу вероятнее всего.
const AD_POSTS_HOURS = 48;

const SETTING = 'leads:last_seen';

// Момент, до которого ответы уже просмотрены. Хранится в базе: иначе после
// каждого перезапуска Render бот заново присылал бы заявки двухдневной
// давности.
async function loadLastSeen() {
  try {
    const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [SETTING]);
    return rows[0] ? Number(rows[0].value) || 0 : 0;
  } catch {
    return 0;
  }
}

async function saveLastSeen(at) {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [SETTING, String(at)]
  );
}

// Какие посты смотреть: последние свои и все рекламные за двое суток.
async function postsToWatch() {
  const ids = new Set();
  for (const post of await threads.recentPosts(RECENT_POSTS)) ids.add(post.id);
  try {
    const { rows } = await db.query(
      `SELECT threads_post_id FROM ad_posts WHERE posted_at > NOW() - INTERVAL '${AD_POSTS_HOURS} hours'`
    );
    for (const row of rows) ids.add(row.threads_post_id);
  } catch (err) {
    console.log(`[заявки] рекламные посты не прочитать (${err.message})`);
  }
  return [...ids];
}

let hooks = { onLead: async () => {}, onDenied: async () => {} };
let denied = false;

// Один обход. Возвращает, сколько заявок нашлось.
async function tick() {
  if (denied || !threads.isConfigured()) return 0;
  const lastSeen = await loadLastSeen();
  // Первый запуск: всё, что было до него, заявками не считаем — иначе в чат
  // разом упали бы вопросы недельной давности.
  if (!lastSeen) {
    await saveLastSeen(Date.now());
    return 0;
  }

  let newest = lastSeen;
  let found = 0;
  let posts;
  try {
    posts = await postsToWatch();
  } catch (err) {
    console.log(`[заявки] свои посты не получить (${err.message})`);
    return 0;
  }

  for (const postId of posts) {
    let replies;
    try {
      replies = await threads.replies(postId);
    } catch (err) {
      if (threads.isPermissionError(err)) {
        denied = true;
        await hooks.onDenied(err).catch(() => {});
        return found;
      }
      console.log(`[заявки] ответы под ${postId} не получить (${err.message})`);
      continue;
    }
    for (const reply of replies) {
      if (reply.at <= lastSeen || reply.mine) continue;
      newest = Math.max(newest, reply.at);
      if (!AD_INTENT.test(reply.text)) continue;
      found += 1;
      await hooks.onLead(reply, postId).catch((err) => console.error('[заявки] не отправить:', err.message));
    }
  }

  if (newest > lastSeen) await saveLastSeen(newest).catch(() => {});
  return found;
}

let timer = null;

function start(given) {
  hooks = { ...hooks, ...given };
  if (timer || !threads.isConfigured()) return;
  timer = setInterval(() => tick().catch((err) => console.error('[заявки]', err)), CHECK_EVERY_MS);
  timer.unref();
}

module.exports = { start, tick, AD_INTENT };

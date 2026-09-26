const db = require('../db');
const threads = require('./threads');

// Просмотры платной рекламы в Threads.
//
// Рекламу у Шабашки покупают с обещанием в шапке профиля: «50 сом —
// гарантированно 1000+ просмотров за 24 часа». До этого модуля обещание никто
// не проверял: пост уходил, и узнать, дотянул ли он, можно было только руками,
// открыв его в приложении. Средний пост в ленте набирает около тысячи — то есть
// гарантия стоит ровно на середине, и часть реклам до неё не дотягивает.
//
// Теперь бот сам:
//  • через несколько часов смотрит, как идёт реклама, и если она отстаёт —
//    предлагает поднять её повтором, пока сутки не прошли (onWarn);
//  • через сутки присылает отчёт с числами — его можно переслать
//    рекламодателю как есть (onReport).
//
// Кампания живёт в базе, а не в памяти: сутки на бесплатном Render без
// перезапуска не проживает ничто, и отчёт, обещанный в памяти, не пришёл бы
// никогда.

// Сколько просмотров обещано. Меняется AD_VIEWS_GOAL — вместе с шапкой профиля.
const GOAL = Number(process.env.AD_VIEWS_GOAL || 1000);

const HOUR_MS = 60 * 60 * 1000;
// Итоговый отчёт — ровно через сутки после первого поста.
const REPORT_AFTER_MS = 24 * HOUR_MS;
// Когда смотреть, отстаёт ли реклама. Просмотры в Threads набираются в первые
// часы: к шестому часу пост, который наберёт тысячу, обычно уже близко к ней.
// Раньше смотреть рано — цифры ещё скачут, позже — поднимать поздно.
const WARN_AFTER_MS = Number(process.env.AD_WARN_HOURS || 6) * HOUR_MS;
// Отстаёт — это меньше этой доли цели к моменту проверки.
const WARN_SHARE = 0.6;
// Как часто обходить открытые кампании и как часто спрашивать статистику
// одного поста: вызовы Graph API считаются в общий лимит приложения.
const CHECK_EVERY_MS = 20 * 60 * 1000;
const REFRESH_EVERY_MS = 15 * 60 * 1000;
// Сколько раз можно поднимать одну рекламу. Больше двух повторов — уже не
// «добрать просмотры», а засорять ленту одним и тем же.
const MAX_BOOSTS = 2;

// Кампанию, до отчёта по которой так и не дошло (сервис лежал сутки), не
// тащим вечно: через трое суток отчитываться поздно.
const FORGET_AFTER_MS = 3 * 24 * HOUR_MS;

const STATS = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'];

// Заводит кампанию по первому опубликованному посту рекламы. media — файл
// рекламодателя ({ kind, fileId }), card — объявление для карточки: по ним
// повтор выйдет таким же постом, как первый.
async function track({ chatId, importId = null, title, threadsText, media = null, card = null, postId }) {
  const mediaKind = media ? media.kind : card ? 'card' : null;
  const { rows } = await db.query(
    `INSERT INTO ad_campaigns (chat_id, import_id, title, threads_text, media_kind, media_file_id, card, goal)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      chatId,
      importId,
      String(title || 'реклама').slice(0, 200),
      threadsText || '',
      mediaKind,
      media ? media.fileId : null,
      card ? JSON.stringify(card) : null,
      GOAL,
    ]
  );
  const id = rows[0].id;
  await addPost(id, postId);
  return id;
}

// Пост кампании: первый или повтор. Ссылку на пост берём сразу — она нужна
// в отчёте, а спрашивать её каждый раз незачем.
async function addPost(campaignId, postId) {
  const { rows } = await db.query(
    'INSERT INTO ad_posts (campaign_id, threads_post_id) VALUES ($1, $2) RETURNING id',
    [campaignId, String(postId)]
  );
  const rowId = rows[0].id;
  threads
    .permalink(postId)
    .then((link) => link && db.query('UPDATE ad_posts SET permalink = $1 WHERE id = $2', [link, rowId]))
    .catch((err) => console.log(`[реклама] ссылку на пост ${postId} не узнать (${err.message})`));
  return rowId;
}

async function get(campaignId) {
  const { rows } = await db.query('SELECT * FROM ad_campaigns WHERE id = $1', [campaignId]);
  return rows[0] || null;
}

async function postsOf(campaignId) {
  const { rows } = await db.query('SELECT * FROM ad_posts WHERE campaign_id = $1 ORDER BY posted_at ASC', [
    campaignId,
  ]);
  return rows;
}

// Сумма по всем постам кампании — повтор затем и делается, чтобы просмотры
// сложились.
function totalsOf(posts) {
  const totals = Object.fromEntries(STATS.map((name) => [name, 0]));
  for (const post of posts) for (const name of STATS) totals[name] += Number(post[name]) || 0;
  return { ...totals, posts: posts.length, boosts: Math.max(0, posts.length - 1) };
}

// Без разрешения threads_manage_insights статистику не получить никак. Говорим
// об этом один раз за запуск и дальше не спрашиваем: каждая попытка — лишний
// вызов в лимит приложения.
let denied = false;

// Свежие числа по постам кампании. Пост, который смотрели недавно, не
// спрашиваем — его числа за четверть часа почти не сдвинулись.
async function refresh(campaign, { force = false } = {}) {
  const posts = await postsOf(campaign.id);
  for (const post of posts) {
    const fresh = post.checked_at && Date.now() - new Date(post.checked_at).getTime() < REFRESH_EVERY_MS;
    if ((fresh && !force) || denied) continue;
    try {
      const stats = await threads.insights(post.threads_post_id);
      Object.assign(post, stats, { checked_at: new Date() });
      await db.query(
        `UPDATE ad_posts SET views = $1, likes = $2, replies = $3, reposts = $4, quotes = $5, shares = $6,
                checked_at = NOW() WHERE id = $7`,
        [...STATS.map((name) => stats[name] || 0), post.id]
      );
    } catch (err) {
      if (threads.isPermissionError(err)) {
        denied = true;
        const error = new Error(err.message);
        error.permission = true;
        throw error;
      }
      console.log(`[реклама] статистика поста ${post.threads_post_id} не пришла (${err.message})`);
    }
  }
  return { posts, totals: totalsOf(posts) };
}

// Кампании, по которым ещё будет отчёт, — для обхода по таймеру.
async function open() {
  const { rows } = await db.query(
    `SELECT * FROM ad_campaigns
      WHERE reported_at IS NULL AND created_at > NOW() - INTERVAL '${FORGET_AFTER_MS / HOUR_MS} hours'
      ORDER BY created_at ASC`
  );
  return rows;
}

// Реклама за последние дни — для /ads.
async function recent(days = 3) {
  const { rows } = await db.query(
    `SELECT * FROM ad_campaigns WHERE created_at > NOW() - ($1 || ' days')::interval ORDER BY created_at DESC LIMIT 20`,
    [String(days)]
  );
  return rows;
}

// Итог за период — для /threads: сколько реклам отчитались и сколько из них
// набрали обещанное. Этими числами гарантия и продаётся.
async function summary(days = 7) {
  const { rows } = await db.query(
    `SELECT c.goal, COALESCE(SUM(p.views), 0)::int AS views
       FROM ad_campaigns c LEFT JOIN ad_posts p ON p.campaign_id = c.id
      WHERE c.created_at > NOW() - ($1 || ' days')::interval AND c.reported_at IS NOT NULL
      GROUP BY c.id`,
    [String(days)]
  );
  return { reported: rows.length, met: rows.filter((row) => row.views >= row.goal).length };
}

const ageOf = (campaign, now = Date.now()) => now - new Date(campaign.created_at).getTime();

// Отстаёт ли реклама от обещания. Сравниваем не с полной целью, а с её долей:
// к шестому часу тысячи нет почти ни у кого, а вот меньше шестисот — это уже
// повод поднимать.
function lagging(totals, goal = GOAL) {
  return totals.views < goal * WARN_SHARE;
}

// Кнопку повтора показываем, пока повторы не кончились и сутки не прошли.
async function canBoost(campaign) {
  const posts = await postsOf(campaign.id);
  return posts.length - 1 < MAX_BOOSTS;
}

async function markWarned(campaignId) {
  await db.query('UPDATE ad_campaigns SET warned_at = NOW() WHERE id = $1', [campaignId]);
}

async function markReported(campaignId) {
  await db.query('UPDATE ad_campaigns SET reported_at = NOW() WHERE id = $1', [campaignId]);
}

let hooks = { onReport: async () => {}, onWarn: async () => {}, onDenied: async () => {} };

// Один обход: итоговые отчёты по суточным кампаниям и предупреждения по
// отстающим. Ошибка одной кампании не останавливает остальные.
async function tick(now = Date.now()) {
  let campaigns;
  try {
    campaigns = await open();
  } catch (err) {
    console.error('[реклама] кампании не прочитать:', err.message);
    return;
  }
  for (const campaign of campaigns) {
    const age = ageOf(campaign, now);
    const due = age >= REPORT_AFTER_MS;
    const warnDue = !due && !campaign.warned_at && age >= WARN_AFTER_MS;
    if (!due && !warnDue) continue;
    try {
      const { posts, totals } = await refresh(campaign, { force: due });
      if (due) {
        await hooks.onReport(campaign, totals, posts, { final: true, boostable: await canBoost(campaign) });
        await markReported(campaign.id);
      } else {
        // Идёт хорошо — молчим: в обычный день предупреждение ничего не добавит.
        if (lagging(totals, campaign.goal)) {
          await hooks.onWarn(campaign, totals, posts, { boostable: await canBoost(campaign) });
        }
        await markWarned(campaign.id);
      }
    } catch (err) {
      if (err.permission) {
        await hooks.onDenied(campaign, err).catch(() => {});
        return;
      }
      console.error(`[реклама] кампания ${campaign.id}:`, err.message);
    }
  }
}

let timer = null;

// hooks — что делать с отчётом и предупреждением. Самим Telegram трекер не
// занимается: как показать числа админу, решает бот (см. telegram/bot.js).
function start(given) {
  hooks = { ...hooks, ...given };
  if (timer || !threads.isConfigured()) return;
  timer = setInterval(() => tick().catch((err) => console.error('[реклама]', err)), CHECK_EVERY_MS);
  timer.unref();
  console.log(
    `[реклама] слежу за просмотрами: цель ${GOAL} за сутки, проверка темпа через ${WARN_AFTER_MS / HOUR_MS} ч`
  );
}

module.exports = {
  track,
  addPost,
  get,
  postsOf,
  refresh,
  recent,
  summary,
  tick,
  start,
  totalsOf,
  lagging,
  canBoost,
  ageOf,
  GOAL,
  MAX_BOOSTS,
  REPORT_AFTER_MS,
  WARN_AFTER_MS,
};

// Застрявшая реклама и «🔁 Поднять сейчас» (см. src/telegram/adRaises.js).
// Очередь Threads живёт в памяти, и перезапуск Render теряет рекламу, которая
// ждала своей минуты: на сайте она есть, в Threads — нет, и кнопки «Поднять» у
// неё не было. После старта бот выкладывает такую рекламу сам, а кнопкой её
// можно поднять и руками. База — PGlite: отбор застрявшей держится на SQL.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at, chat, statsStub } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

const db = memoryDb();
const tg = chat();
const stats = statsStub();

// Площадки: что подняли и чем ответили. Кампании — в той же базе, как у
// настоящего adTracker: по ним решается, выходила ли реклама в Threads.
const raised = [];
const tracked = [];
let threadsAnswer = () => ({ posted: true, id: `t${raised.length}`, text: 'Пост для Threads' });
const social = {
  threadsConfigured: () => true,
  raiseAd: async (job) => {
    raised.push(job);
    return {
      threads: job.threads ? threadsAnswer(job) : null,
      instagram: job.instagram ? { posted: true, id: `ig${raised.length}` } : null,
    };
  },
  adTracker: {
    WARN_AFTER_MS: 6 * HOUR,
    byImport: async (id) =>
      (await db.query('SELECT * FROM ad_campaigns WHERE import_id = $1 ORDER BY id DESC LIMIT 1', [id])).rows[0] || null,
    addPost: (campaignId, postId) =>
      db.query('INSERT INTO ad_posts (campaign_id, threads_post_id) VALUES ($1, $2)', [campaignId, postId]),
    track: async (args) => {
      tracked.push(args);
      const { rows } = await db.query(
        'INSERT INTO ad_campaigns (chat_id, import_id, title, threads_text) VALUES ($1, $2, $3, $4) RETURNING id',
        [args.chatId, args.importId, args.title, args.threadsText]
      );
      await social.adTracker.addPost(rows[0].id, args.postId);
      return rows[0].id;
    },
  },
};

const requireSrc = install({
  [at('db/index.js')]: db,
  [at('telegram/api.js')]: tg.api,
  [at('telegram/feedStats.js')]: stats.feedStats,
  [at('telegram/adGroups.js')]: { firstPost: async () => null, repeat: async () => ({ queued: 2 }) },
  [at('social/index.js')]: social,
});
const raises = requireSrc('telegram/adRaises.js');

const reports = [];
const deps = {
  report: async (chatId, text) => reports.push({ chatId, text }),
  siteLink: (ad) => `шабашка.com/vacancies/${ad.vacancy_id}`,
};

let userId;
async function vacancy(title) {
  const { rows } = await db.query(
    `INSERT INTO vacancies (user_id, title, description, category, employment_type, city, work_format, experience, whatsapp_phone)
     VALUES ($1, $2, 'Описание', 'Общепит', 'gig', 'Бишкек', 'offline', 'no_experience', '+996700123456') RETURNING id`,
    [userId, title]
  );
  return rows[0].id;
}

// Реклама на сайте: ago — сколько назад вышла; остальное — поверх.
async function ad(title, ago, extra = {}) {
  const row = {
    is_ad: true,
    status: 'published',
    vacancy_id: await vacancy(title),
    threads_post_id: null,
    instagram_media_id: null,
    ...extra,
  };
  const at = new Date(Date.now() - ago);
  const { rows } = await db.query(
    `INSERT INTO imported_listings (source, raw_text, parsed, status, is_ad, vacancy_id, tg_chat_id,
                                    threads_post_id, instagram_media_id, created_at, published_at)
     VALUES ('telegram', $1, $2, $3, $4, $5, 42, $6, $7, $8, $8) RETURNING id`,
    [
      `${title}, 0700123456`,
      { title, listing_type: 'vacancy' },
      row.status,
      row.is_ad,
      row.vacancy_id,
      row.threads_post_id,
      row.instagram_media_id,
      at,
    ]
  );
  return rows[0].id;
}

const listing = async (id) => (await db.query('SELECT * FROM imported_listings WHERE id = $1', [id])).rows[0];

test.before(async () => {
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
     VALUES ('Бот', 'resend@test.kg', '+996700007002', 'x', true, 'customer') RETURNING id`
  );
  userId = rows[0].id;
});

test('застрявшая: реклама за сутки без поста в Threads, вышедшая до старта, — выкладывается один раз', async () => {
  const startedAt = new Date(Date.now() - 30 * MIN);
  const lost = await ad('Официанты', 2 * HOUR);
  const instagramOut = await ad('Бариста', 3 * HOUR, { instagram_media_id: '1801' });
  // Не застрявшие:
  await ad('Вышла в Threads', 2 * HOUR, { threads_post_id: '1790' });
  const withCampaign = await ad('С кампанией', 2 * HOUR);
  await db.query("INSERT INTO ad_campaigns (chat_id, import_id, title, threads_text) VALUES (42, $1, 'С кампанией', 'т')", [withCampaign]);
  await ad('Снятая', 2 * HOUR, { status: 'rejected' });
  await ad('Позавчерашняя', 30 * HOUR);
  await ad('Не реклама', 2 * HOUR, { is_ad: false });
  await ad('После старта', 10 * MIN);

  assert.deepEqual(
    (await raises.stuck(startedAt)).map((r) => r.id),
    [lost, instagramOut]
  );

  assert.equal(await raises.resendStuck(deps, startedAt), 2);
  const [first, second] = raised.splice(0);
  assert.equal(first.text, 'Официанты, 0700123456', 'текст рекламодателя');
  assert.deepEqual(first.card, { parsed: { title: 'Официанты', listing_type: 'vacancy' }, listingType: 'vacancy' });
  assert.equal(first.siteLink, `шабашка.com/vacancies/${(await listing(lost)).vacancy_id}`);
  assert.deepEqual([first.threads, first.instagram], [true, true]);
  assert.deepEqual([second.threads, second.instagram], [true, false], 'в Instagram она уже вышла — второй раз не надо');

  const after = await listing(lost);
  assert.equal(after.threads_post_id, 't1', 'id поста — для снятия');
  assert.equal(after.instagram_media_id, 'ig1');
  assert.ok(after.resent_at);
  // Пост первый — по нему заводится кампания: отчёт, «отстаёт», следующие поднятия.
  assert.deepEqual(tracked[0], {
    chatId: 42,
    importId: lost,
    title: 'Официанты',
    threadsText: 'Пост для Threads',
    media: null,
    card: first.card,
    postId: 't1',
  });

  assert.equal(reports[0].chatId, 42);
  assert.match(reports[0].text, /^♻️ «Официанты» так и не вышла в Threads: сервер перезапускался, и очередь пропала/);
  assert.match(reports[0].text, /🧵 Threads — опубликовано\. Слежу за просмотрами: через 6 ч скажу/);
  assert.match(reports[0].text, /📸 Instagram — опубликовано/);
  assert.doesNotMatch(reports[1].text, /Instagram/);

  assert.equal(await raises.resendStuck(deps, startedAt), 0, 'второй раз не трогаем');
});

test('застрявшая, а Threads опять не принял — так и говорим, и что делать', async () => {
  reports.length = 0;
  const startedAt = new Date(Date.now() - 30 * MIN);
  const id = await ad('Повар', HOUR);
  threadsAnswer = () => ({ posted: false, reason: 'антиспам Threads', text: 'Пост' });
  await raises.resendStuck(deps, startedAt);
  threadsAnswer = () => ({ posted: true, id: `t${raised.length}`, text: 'Пост для Threads' });
  raised.length = 0;

  assert.match(reports[0].text, /⚠️ Threads: антиспам Threads/);
  assert.match(reports[0].text, /«🔁 Поднять сейчас» в карточке рекламы/);
  assert.equal((await listing(id)).threads_post_id, null);
  assert.equal(await social.adTracker.byImport(id), null, 'кампании без поста нет');
  assert.equal(await raises.resendStuck(deps, startedAt), 0, 'повтор — только кнопкой');
});

test('«Поднять сейчас»: только что вышедшую — рано, застрявшую — выкладывает, вышедшую — поднимает', async () => {
  reports.length = 0;

  const fresh = await ad('Свежая', 10 * MIN);
  assert.deepEqual(await raises.nowMode(await listing(fresh)), { mode: 'soon', waitMin: 20 }, 'ещё может ждать очереди Threads');

  const lost = await ad('Кассир', 2 * HOUR);
  assert.deepEqual(await raises.nowMode(await listing(lost)), { mode: 'resend' });
  assert.equal(await raises.raiseNow(lost, 7, deps), 'resend');
  assert.match(reports.at(-1).text, /^🧵 «Кассир» в Threads ещё не выходила — выложил заново:/);
  assert.equal(reports.at(-1).chatId, 7);
  assert.equal(tracked.at(-1).importId, lost);
  assert.equal((await raises.nowMode(await listing(lost))).mode, 'soon', 'только что выложили');

  // Вышла три часа назад, первый пост — два часа назад: поднимаем, как по плану.
  const out = await ad('Курьер', 3 * HOUR, { threads_post_id: '555', instagram_media_id: '777' });
  const { rows } = await db.query(
    "INSERT INTO ad_campaigns (chat_id, import_id, title, threads_text) VALUES (42, $1, 'Курьер', 'Курьер — как в первый раз') RETURNING id",
    [out]
  );
  await db.query("INSERT INTO ad_posts (campaign_id, threads_post_id, posted_at) VALUES ($1, '555', NOW() - INTERVAL '2 hours')", [
    rows[0].id,
  ]);
  assert.deepEqual(await raises.nowMode(await listing(out)), { mode: 'raise' });
  raised.length = 0;
  assert.equal(await raises.raiseNow(out, 7, deps), 'raise');
  assert.equal(raised[0].threadsText, 'Курьер — как в первый раз', 'тот же пост, что вышел в первый раз');
  assert.match(reports.at(-1).text, /^🔁 Поднял «Курьер»: 🌐 сайт · 🧵 Threads · 📸 Instagram · 👥 группы Telegram: 2$/);
  const posts = await db.query('SELECT * FROM ad_posts WHERE campaign_id = $1', [rows[0].id]);
  assert.equal(posts.rows.length, 2, 'пост поднятия — в ту же кампанию, просмотры сложатся');
  const summary = raises.summarize(await raises.rows(out));
  assert.deepEqual([summary.done, summary.total], [1, 1], 'поднятие записано в план');
  assert.equal((await raises.nowMode(await listing(out))).mode, 'soon', 'второй раз подряд — нет');

  await db.query("UPDATE imported_listings SET status = 'rejected' WHERE id = $1", [out]);
  assert.deepEqual(await raises.nowMode(await listing(out)), { mode: 'gone' });
  assert.deepEqual(await raises.nowMode(null), { mode: 'gone' });
});

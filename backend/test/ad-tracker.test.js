// Слежка за просмотрами платной рекламы в Threads (см. src/social/adTracker.js).
//
// В шапке профиля обещано «1000+ просмотров за 24 часа», а средний пост в ленте
// набирает около тысячи — гарантия стоит ровно на середине. Трекер должен:
// заводить кампанию по посту, складывать просмотры повторов, предупреждать об
// отставании только однажды и только когда отстаёт, отчитываться ровно через
// сутки и честно сказать, если статистику Threads не отдаёт.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { fakeDb } = require('./helpers/fakeDb');

const db = fakeDb();
const stats = new Map(); // id поста → числа, которые «вернёт» Threads
let insightsError = null;
let insightsCalls = 0;

const requireSrc = install({
  [at('db/index.js')]: db,
  [at('social/threads.js')]: {
    isConfigured: () => true,
    permalink: async (id) => `https://www.threads.com/@shabashka.com_/post/${id}`,
    insights: async (id) => {
      insightsCalls += 1;
      if (insightsError) throw insightsError;
      return { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, shares: 0, ...(stats.get(id) || {}) };
    },
    isPermissionError: (err) => Boolean(err && err.code === 10),
  },
});

const tracker = requireSrc('social/adTracker.js');

const HOUR = 3600 * 1000;
const tick = () => new Promise((r) => setImmediate(r));

// Сдвинуть кампанию в прошлое — будто она вышла столько-то часов назад.
function age(campaignId, hours) {
  db.campaigns.find((c) => c.id === campaignId).created_at = new Date(Date.now() - hours * HOUR);
  for (const post of db.posts.filter((p) => p.campaign_id === campaignId)) post.checked_at = null;
}

const reports = [];
const warns = [];
const denials = [];
tracker.start({
  onReport: async (campaign, totals, posts, info) => reports.push({ campaign, totals, info }),
  onWarn: async (campaign, totals, posts, info) => warns.push({ campaign, totals, info }),
  onDenied: async () => denials.push(true),
});

test('реклама заводит кампанию, а ссылка на пост подтягивается сама', async () => {
  const id = await tracker.track({
    chatId: 1,
    importId: 7,
    title: 'Требуются бариста',
    threadsText: '📣 Реклама\n💼 Вакансия: бариста',
    media: { kind: 'image', fileId: 'file-1' },
    postId: 'p1',
  });
  await tick();
  const campaign = await tracker.get(id);
  assert.equal(campaign.media_kind, 'image');
  assert.equal(campaign.media_file_id, 'file-1', 'по file_id повтор выйдет с тем же файлом');
  assert.equal(campaign.goal, 1000);
  const [post] = await tracker.postsOf(id);
  assert.match(post.permalink, /post\/p1$/);
});

test('пока рано, трекер молчит и Threads лишний раз не спрашивает', async () => {
  const before = insightsCalls;
  await tracker.tick();
  assert.equal(warns.length, 0);
  assert.equal(reports.length, 0);
  assert.equal(insightsCalls, before, 'через минуту после выхода смотреть нечего');
});

test('отстающая реклама — одно предупреждение с кнопкой, а не по одному на каждый обход', async () => {
  age(1, 7);
  stats.set('p1', { views: 320, likes: 4 });
  await tracker.tick();
  assert.equal(warns.length, 1);
  assert.equal(warns[0].totals.views, 320);
  assert.equal(warns[0].info.boostable, true, 'повторов ещё не было — можно поднять');
  await tracker.tick();
  assert.equal(warns.length, 1, 'второй раз о том же не пишем');
});

test('реклама, которая идёт хорошо, предупреждения не получает', async () => {
  const id = await tracker.track({ chatId: 1, title: 'Хорошая', threadsText: 'текст', postId: 'p2' });
  age(id, 7);
  stats.set('p2', { views: 900 });
  await tracker.tick();
  assert.equal(warns.filter((w) => w.campaign.id === id).length, 0);
  assert.ok((await tracker.get(id)).warned_at, 'но проверка отмечена — второй раз не смотрим');
});

test('повтор добавляется к кампании, и просмотры складываются', async () => {
  await tracker.addPost(1, 'p1-boost');
  stats.set('p1-boost', { views: 750, likes: 9 });
  const { totals } = await tracker.refresh(await tracker.get(1), { force: true });
  assert.equal(totals.views, 1070);
  assert.equal(totals.likes, 13);
  assert.equal(totals.boosts, 1);
});

test('через сутки — итоговый отчёт, ровно один', async () => {
  age(1, 25);
  await tracker.tick();
  const report = reports.find((r) => r.campaign.id === 1);
  assert.ok(report, 'отчёт пришёл');
  assert.equal(report.info.final, true);
  assert.equal(report.totals.views, 1070, 'с повтором гарантия набрана');
  await tracker.tick();
  assert.equal(reports.filter((r) => r.campaign.id === 1).length, 1, 'второй раз не присылаем');
});

test('поднимать можно не больше двух раз', async () => {
  const campaign = await tracker.get(1);
  assert.equal(await tracker.canBoost(campaign), true, 'один повтор был — второй можно');
  await tracker.addPost(1, 'p1-boost-2');
  assert.equal(await tracker.canBoost(campaign), false, 'два повтора — хватит');
});

test('итог за неделю — сколько реклам набрали гарантию', async () => {
  const summary = await tracker.summary(7);
  assert.equal(summary.reported, 1);
  assert.equal(summary.met, 1);
});

test('без разрешения на статистику — одно сообщение, без попыток на каждом обходе', async () => {
  const id = await tracker.track({ chatId: 1, title: 'Без статистики', threadsText: 'текст', postId: 'p3' });
  age(id, 25);
  insightsError = Object.assign(new Error('(#10) Application does not have permission'), { code: 10 });
  await tracker.tick();
  assert.equal(denials.length, 1);
  const calls = insightsCalls;
  await tracker.tick();
  assert.equal(insightsCalls, calls, 'после отказа Threads больше не спрашиваем');
  insightsError = null;
});

test('отставание — меньше шести десятых цели', () => {
  assert.equal(tracker.lagging({ views: 599 }), true);
  assert.equal(tracker.lagging({ views: 600 }), false);
});

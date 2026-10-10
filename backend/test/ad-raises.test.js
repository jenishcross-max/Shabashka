// Поднятия платной рекламы по расписанию (см. src/telegram/adRaises.js): по
// умолчанию три дня подряд, в 09:00 и 13:00 по Бишкеку, — на сайте, в Threads,
// Instagram и группах Telegram.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at, chat, statsStub } = require('./helpers/stub');

const HOUR = 60 * 60 * 1000;
let fakeNow = Date.parse('2026-10-08T09:00:00Z');

// ─── Фальшивая база: только ad_raises.
const rows = [];
let seq = 0;
async function query(sql, params = []) {
  const q = sql.replace(/\s+/g, ' ').trim();
  if (q.startsWith('INSERT INTO ad_raises')) {
    for (let i = 0; i < params.length; i += 3) {
      rows.push({ id: (seq += 1), import_id: params[i], chat_id: params[i + 1], due_at: params[i + 2], status: 'pending', result: null });
    }
    return { rows: [], rowCount: params.length / 3 };
  }
  if (q.startsWith('SELECT * FROM ad_raises WHERE import_id = $1')) {
    return { rows: rows.filter((r) => r.import_id === params[0]).sort((a, b) => a.due_at - b.due_at || a.id - b.id).map((r) => ({ ...r })) };
  }
  if (q.startsWith("UPDATE ad_raises SET status = 'cancelled'")) {
    const hit = rows.filter((r) => r.import_id === params[0] && r.status === 'pending');
    for (const r of hit) r.status = 'cancelled';
    return { rows: [], rowCount: hit.length };
  }
  if (q.startsWith('SELECT MAX(due_at)')) {
    const live = rows.filter((r) => r.import_id === params[0] && r.status !== 'cancelled').map((r) => r.due_at.getTime());
    return { rows: [{ at: live.length ? new Date(Math.max(...live)) : null }] };
  }
  if (q.startsWith('UPDATE ad_raises SET status = $2, result = $3')) {
    Object.assign(rows.find((r) => r.id === params[0]), { status: params[1], result: params[2] });
    return { rows: [] };
  }
  if (q.startsWith("UPDATE ad_raises SET status = 'running'")) {
    const due = rows.filter((r) => r.status === 'pending' && r.due_at.getTime() <= fakeNow).sort((a, b) => a.due_at - b.due_at);
    for (const r of due) r.status = 'running';
    return { rows: due.map((r) => ({ ...r })) };
  }
  throw new Error(`фальшивая база не знает запроса: ${q.slice(0, 90)}`);
}

// ─── Всё вокруг: реклама, группы, площадки.
const tg = chat();
const stats = statsStub();
const settingsStore = {};
stats.feedStats.getSetting = async (key) => settingsStore[key] || '';
stats.feedStats.setSetting = async (key, value) => {
  settingsStore[key] = value;
};

const listings = new Map();
const bumped = [];
const repeated = [];
const raised = [];
const addedPosts = [];
let raiseResult = () => ({ threads: { posted: true, id: 'tp' }, instagram: { posted: true, id: 'ip' } });
let groupsResult = () => ({ queued: 4, lastAt: Date.now() });

const requireSrc = install({
  [at('db/index.js')]: { query },
  [at('telegram/api.js')]: { ...tg.api, downloadFile: async (fileId) => Buffer.from(`файл ${fileId}`) },
  [at('telegram/feedStats.js')]: stats.feedStats,
  [at('telegram/imports.js')]: {
    get: async (id) => (listings.has(id) ? { ...listings.get(id) } : null),
    bump: async (row) => {
      bumped.push(row.id);
      return true;
    },
  },
  [at('telegram/adGroups.js')]: {
    firstPost: async () => null,
    repeat: async (args) => {
      repeated.push(args);
      return groupsResult(args);
    },
  },
  [at('social/index.js')]: {
    adTracker: {
      byImport: async (id) =>
        id === 7 ? { id: 70, media_kind: 'video', media_file_id: 'ролик', threads_text: 'Текст для Threads' } : null,
      addPost: async (campaignId, postId) => {
        addedPosts.push([campaignId, postId]);
      },
    },
    raiseAd: async (job) => {
      raised.push(job);
      return raiseResult(job);
    },
  },
});

const raises = requireSrc('telegram/adRaises.js');
const menu = requireSrc('telegram/menu.js');

const reports = [];
const deps = {
  report: async (chatId, text) => {
    reports.push(text);
  },
  siteLink: (ad) => `шабашка.com/vacancies/${ad.id}`,
};

const bishkek = (iso) => new Date(Date.parse(`${iso}+06:00`));

test('по умолчанию — три дня с завтрашнего, в 09:00 и 13:00 по Бишкеку', () => {
  // 15:00 по Бишкеку, 8 октября.
  const dates = raises.slots(raises.DEFAULT_PLAN, Date.parse('2026-10-08T09:00:00Z'));
  assert.deepEqual(
    dates.map((d) => d.toISOString()),
    [
      bishkek('2026-10-09T09:00:00').toISOString(),
      bishkek('2026-10-09T13:00:00').toISOString(),
      bishkek('2026-10-10T09:00:00').toISOString(),
      bishkek('2026-10-10T13:00:00').toISOString(),
      bishkek('2026-10-11T09:00:00').toISOString(),
      bishkek('2026-10-11T13:00:00').toISOString(),
    ]
  );
  // 01:30 по Бишкеку 9-го — по UTC это ещё 8-е, но «завтра» считаем по Бишкеку.
  const night = raises.slots({ days: 1, times: ['09:00'] }, Date.parse('2026-10-08T19:30:00Z'));
  assert.equal(night[0].toISOString(), bishkek('2026-10-10T09:00:00').toISOString());
});

test('настройки: дни, время и площадки сохраняются и идут в новый план', async () => {
  assert.deepEqual(await raises.settings(), raises.DEFAULT_PLAN);
  await raises.setDays(2);
  await raises.setTimes(2);
  await raises.toggle('groups');
  const plan = await raises.settings();
  assert.equal(plan.days, 2);
  assert.deepEqual(plan.times, ['09:00', '13:00', '18:00']);
  assert.equal(plan.to.groups, false);
  assert.match(menu.raisePlanText(plan), /^6 поднятий: 2 дня подряд с завтрашнего в 09:00, 13:00 и 18:00 — 🌐 сайт, 🧵 Threads, 📸 Instagram$/);

  const view = menu.raiseSettingsView(plan, { dayOptions: raises.DAY_OPTIONS, timePresets: raises.TIME_PRESETS, active: true });
  const buttons = view.extra.reply_markup.inline_keyboard.flat().map((b) => b.text);
  assert.ok(buttons.includes('✅ 2'));
  assert.ok(buttons.includes('⬜ Группы'));

  await raises.setDays(0);
  assert.equal(raises.active(await raises.settings()), false);
  assert.deepEqual(await raises.plan(1, 42), { count: 0, plan: await raises.settings() });
  assert.equal(rows.length, 0, 'выключено — не планируем');

  // Обратно к стандарту для остальных тестов.
  settingsStore['adraise:plan'] = '';
});

test('поднятие: сайт, тот же ролик в Threads и Instagram, группы — и итог после последнего', async () => {
  listings.set(7, { id: 7, status: 'published', raw_text: 'Требуется бариста, 0700123456', parsed: { title: 'Бариста', listing_type: 'vacancy' } });
  fakeNow = Date.parse('2026-10-08T09:00:00Z');
  const { count } = await raises.plan(7, 42, fakeNow);
  assert.equal(count, 6);

  // До 09:00 следующего дня — ничего.
  fakeNow = bishkek('2026-10-09T08:59:00').getTime();
  assert.equal((await raises.tick(deps, fakeNow)).count, 0);

  fakeNow = bishkek('2026-10-09T09:00:30').getTime();
  const first = await raises.tick(deps, fakeNow);
  await first.done;
  assert.equal(first.count, 1);
  assert.deepEqual(bumped, [7]);
  assert.equal(raised.length, 1);
  assert.equal(raised[0].threadsText, 'Текст для Threads', 'тот же пост, что вышел в первый раз');
  assert.equal(String(raised[0].media.buffer), 'файл ролик', 'файл рекламодателя — заново из Telegram');
  assert.equal(raised[0].siteLink, 'шабашка.com/vacancies/7');
  assert.deepEqual(addedPosts, [[70, 'tp']], 'пост поднятия — в ту же кампанию, просмотры сложатся');
  assert.deepEqual(repeated, [{ importId: 7, chatId: 42, text: 'Требуется бариста, 0700123456' }]);
  assert.equal(stats.counters['raise.ok'], 1);
  assert.equal(reports.length, 0, 'об удачном поднятии в чат не пишем — оно в сводке');

  const summary = raises.summarize(await raises.rows(7));
  assert.deepEqual([summary.done, summary.total, summary.pending], [1, 6, 5]);
  assert.match(menu.raiseSummaryText(summary), /^1 из 6 · следующее — 9 октября в 13:00/);

  for (const [day, time] of [['09', '13'], ['10', '09'], ['10', '13'], ['11', '09'], ['11', '13']]) {
    fakeNow = bishkek(`2026-10-${day}T${time}:00:10`).getTime();
    await (await raises.tick(deps, fakeNow)).done;
  }
  assert.equal(bumped.length, 6);
  assert.equal(reports.length, 1);
  assert.match(reports[0], /Поднятия «Бариста» закончились: 6 из 6/);
  assert.match(reports[0], /Threads: 6 постов/);
  assert.match(reports[0], /Группы Telegram: 24 поста/);
});

test('не вышло нигде — говорим сразу; опоздали больше чем на два часа — пропускаем', async () => {
  listings.set(8, { id: 8, status: 'published', raw_text: 'Сдаю квартиру', parsed: { title: 'Квартира', listing_type: 'board' } });
  fakeNow = Date.parse('2026-10-08T09:00:00Z');
  await raises.plan(8, 42, fakeNow);
  reports.length = 0;

  raiseResult = () => ({ threads: { posted: false, reason: 'антиспам Threads' }, instagram: { posted: false, reason: 'норма выбрана' } });
  groupsResult = () => ({ queued: 0, reason: 'рассылка выключена' });
  const imports = requireSrc('telegram/imports.js');
  const bump = imports.bump;
  imports.bump = async () => false;

  fakeNow = bishkek('2026-10-09T09:01:00').getTime();
  await (await raises.tick(deps, fakeNow)).done;
  assert.match(reports.at(-1), /Поднятие «Квартира» не вышло нигде/);
  assert.match(reports.at(-1), /антиспам Threads/);
  assert.equal(rows.find((r) => r.import_id === 8).status, 'failed');
  assert.equal(raised.at(-1).card.listingType, 'board', 'без файла — карточка из объявления');

  // Сервер лежал с утра до 15:05 — 13:00 уже не поднимаем.
  fakeNow = bishkek('2026-10-09T15:05:00').getTime();
  await (await raises.tick(deps, fakeNow)).done;
  const midday = rows.filter((r) => r.import_id === 8)[1];
  assert.equal(midday.status, 'skipped');

  imports.bump = bump;
  raiseResult = () => ({ threads: { posted: true, id: 'tp' }, instagram: { posted: true, id: 'ip' } });
  groupsResult = () => ({ queued: 4, lastAt: Date.now() });
});

test('сняли рекламу — оставшиеся поднятия отменяются сами', async () => {
  listings.set(9, { id: 9, status: 'published', raw_text: 'Нужен сантехник', parsed: { title: 'Сантехник', listing_type: 'order' } });
  fakeNow = Date.parse('2026-10-08T09:00:00Z');
  await raises.plan(9, 42, fakeNow);
  listings.get(9).status = 'rejected';

  fakeNow = bishkek('2026-10-09T09:00:30').getTime();
  const before = raised.length;
  await (await raises.tick(deps, fakeNow)).done;
  assert.equal(raised.length, before, 'снятую не поднимаем');
  assert.ok(rows.filter((r) => r.import_id === 9).every((r) => r.status === 'cancelled'));
});

test('остановить, продлить на день, заново по настройкам', async () => {
  listings.set(10, { id: 10, status: 'published', raw_text: 'Реклама', parsed: { title: 'Реклама' } });
  fakeNow = Date.parse('2026-10-08T09:00:00Z');
  await raises.plan(10, 42, fakeNow);

  assert.equal(await raises.cancel(10), 6);
  let summary = raises.summarize(await raises.rows(10));
  assert.equal(summary.stopped, true);
  assert.match(menu.raiseSummaryText(summary), /остановлены/);

  // План кончился (всё отменено) — «ещё день» начинается с завтра.
  assert.equal(await raises.extend(10, 42, fakeNow), 2);
  const live = (await raises.rows(10)).filter((r) => r.status === 'pending');
  assert.deepEqual(
    live.map((r) => r.due_at.toISOString()),
    [bishkek('2026-10-09T09:00:00').toISOString(), bishkek('2026-10-09T13:00:00').toISOString()]
  );
  // Ещё один — после последнего запланированного.
  await raises.extend(10, 42, fakeNow);
  const last = (await raises.rows(10)).filter((r) => r.status === 'pending').at(-1);
  assert.equal(last.due_at.toISOString(), bishkek('2026-10-10T13:00:00').toISOString());

  const again = await raises.restart(10, 42, fakeNow);
  assert.equal(again.count, 6);
  summary = raises.summarize(await raises.rows(10));
  assert.deepEqual([summary.pending, summary.total], [6, 6]);

  const view = menu.raisesView({ ad: listings.get(10), list: await raises.rows(10), summary, page: 2 });
  const data = view.extra.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(data.includes('rz:s:10:2'));
  assert.ok(data.includes('rz:e:10:2'));
  assert.ok(data.includes('ai:10:2'));
  assert.match(view.text, /Отменено: 10/);
});

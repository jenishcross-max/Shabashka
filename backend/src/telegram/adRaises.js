// Поднятия платной рекламы по расписанию.
//
// Реклама выходит один раз — и через несколько часов уезжает вниз ленты, а
// рекламодатель платил за то, чтобы его видели. Поэтому после публикации бот
// сам поднимает её ещё несколько раз: по умолчанию три дня подряд, утром и в
// обед (09:00 и 13:00 по Бишкеку), — то есть шесть поднятий. Поднятие — это:
//  • на сайте — карточка снова наверху ленты (записка на доске — ещё на сутки);
//  • в Threads и в Instagram — тот же пост ещё раз;
//  • в группах Telegram — та же реклама ещё раз, через ту же очередь с паузами.
//
// Сколько дней, во сколько и куда — настраивается в «☰ Меню → 🔁 Поднятия
// рекламы» и применяется к новой рекламе; у каждой рекламы план можно
// остановить, продлить на день или построить заново («📣 Реклама» → «ℹ️»).
//
// План лежит в базе (ad_raises): три дня на бесплатном Render без перезапуска
// не проживает ничто.
const db = require('../db');
const tg = require('./api');
const imports = require('./imports');
const adGroups = require('./adGroups');
const feedStats = require('./feedStats');
const social = require('../social');
const { clamp, plural } = require('./format');

const HOUR_MS = 60 * 60 * 1000;
// Кыргызстан живёт по UTC+6 круглый год, без перевода часов.
const BISHKEK_OFFSET_MS = 6 * HOUR_MS;
// Опоздали больше чем на два часа (сервер лежал) — поднятие пропускаем: в
// 13:00 подряд за утренним оно было бы двумя одинаковыми постами.
const LATE_MS = 2 * HOUR_MS;
const TICK_MS = 60 * 1000;
// Сколько поднятий берём за один заход. Дальше их всё равно разводят очереди
// площадок, а сайт и группы получают своё сразу.
const BATCH = 10;

const KEY = 'adraise:plan';
const PLATFORMS = ['site', 'threads', 'instagram', 'groups'];
const DEFAULT_PLAN = { days: 3, times: ['09:00', '13:00'], to: { site: true, threads: true, instagram: true, groups: true } };
const DAY_OPTIONS = [0, 1, 2, 3, 5, 7];
const TIME_PRESETS = [['09:00'], ['09:00', '13:00'], ['09:00', '13:00', '18:00']];

const copy = (plan) => JSON.parse(JSON.stringify(plan));

async function settings() {
  let saved = {};
  try {
    saved = JSON.parse((await feedStats.getSetting(KEY)) || '{}');
  } catch {
    saved = {};
  }
  return { ...copy(DEFAULT_PLAN), ...saved, to: { ...DEFAULT_PLAN.to, ...(saved.to || {}) } };
}

async function save(change) {
  const plan = { ...(await settings()), ...change };
  await feedStats.setSetting(KEY, JSON.stringify(plan));
  return plan;
}

const setDays = (days) => save({ days: DAY_OPTIONS.includes(Number(days)) ? Number(days) : DEFAULT_PLAN.days });
const setTimes = (preset) => save({ times: TIME_PRESETS[Number(preset)] || DEFAULT_PLAN.times });
async function toggle(platform) {
  const plan = await settings();
  if (!PLATFORMS.includes(platform)) return plan;
  return save({ to: { ...plan.to, [platform]: !plan.to[platform] } });
}

const active = (plan) => plan.days > 0 && plan.times.length > 0 && PLATFORMS.some((k) => plan.to[k]);

// Когда поднимать: с дня после from (по Бишкеку) — days дней, в каждое время
// из times. С завтрашнего, а не с сегодняшнего: сегодня реклама только что
// вышла и и так наверху.
function slots({ days, times }, from = Date.now()) {
  const local = new Date(from + BISHKEK_OFFSET_MS);
  const [y, m, d] = [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()];
  const out = [];
  for (let k = 1; k <= days; k += 1) {
    for (const time of times) {
      const [hh, mm] = time.split(':').map(Number);
      out.push(new Date(Date.UTC(y, m, d + k, hh, mm) - BISHKEK_OFFSET_MS));
    }
  }
  return out;
}

async function insert(importId, chatId, dates) {
  if (!dates.length) return;
  const params = [];
  const values = dates.map((date) => {
    params.push(importId, chatId, date);
    const k = params.length - 3;
    return `($${k + 1}, $${k + 2}, $${k + 3})`;
  });
  await db.query(`INSERT INTO ad_raises (import_id, chat_id, due_at) VALUES ${values.join(', ')}`, params);
}

// План поднятий для только что вышедшей рекламы. Возвращает { count, plan } —
// для строки в отчёте о публикации.
async function plan(importId, chatId, now = Date.now()) {
  const current = await settings();
  if (!active(current)) return { count: 0, plan: current };
  const dates = slots(current, now);
  await insert(importId, chatId, dates);
  return { count: dates.length, plan: current };
}

async function rows(importId) {
  const { rows: list } = await db.query('SELECT * FROM ad_raises WHERE import_id = $1 ORDER BY due_at, id', [importId]);
  return list;
}

// Сводка для карточки рекламы: сколько сделано из скольких и когда следующее.
function summarize(list) {
  const live = list.filter((r) => r.status !== 'cancelled');
  const pending = live.filter((r) => r.status === 'pending' || r.status === 'running');
  return {
    total: live.length,
    done: live.filter((r) => r.status === 'done').length,
    failed: live.filter((r) => r.status === 'failed' || r.status === 'skipped').length,
    pending: pending.length,
    next: pending.length ? pending[0].due_at : null,
    stopped: list.some((r) => r.status === 'cancelled') && !pending.length,
  };
}

// Остановить: ждущие поднятия отменяются, сделанные остаются в истории.
async function cancel(importId) {
  const result = await db.query(
    "UPDATE ad_raises SET status = 'cancelled', done_at = NOW() WHERE import_id = $1 AND status = 'pending'",
    [importId]
  );
  return result.rowCount || 0;
}

// Ещё день поднятий — после последнего запланированного или с завтра, если
// план уже кончился.
async function extend(importId, chatId, now = Date.now()) {
  const current = await settings();
  const { rows: last } = await db.query(
    "SELECT MAX(due_at) AS at FROM ad_raises WHERE import_id = $1 AND status <> 'cancelled'",
    [importId]
  );
  const from = Math.max(now, last[0] && last[0].at ? new Date(last[0].at).getTime() : 0);
  const dates = slots({ days: 1, times: current.times.length ? current.times : DEFAULT_PLAN.times }, from);
  await insert(importId, chatId, dates);
  return dates.length;
}

// Заново по текущим настройкам — например, после того как их поменяли.
async function restart(importId, chatId, now = Date.now()) {
  await cancel(importId);
  return plan(importId, chatId, now);
}

async function finish(row, status, result) {
  await db.query('UPDATE ad_raises SET status = $2, result = $3, done_at = NOW() WHERE id = $1', [
    row.id,
    status,
    JSON.stringify(result),
  ]);
}

const brief = (r) => (r ? { posted: Boolean(r.posted), id: r.id || null, reason: r.reason || null } : null);

// Файл и карточка для поста: из кампании в Threads (там записано, каким вышел
// первый пост), иначе — из рассылки по группам. Ни того ни другого — Threads
// уйдёт текстом с карточкой, Instagram — карточкой.
async function payload(listing) {
  const campaign = await social.adTracker.byImport(listing.id).catch(() => null);
  const notes = [];

  let kind = null;
  let fileId = null;
  if (campaign && (campaign.media_kind === 'image' || campaign.media_kind === 'video') && campaign.media_file_id) {
    [kind, fileId] = [campaign.media_kind, campaign.media_file_id];
  } else {
    const group = await adGroups.firstPost(listing.id).catch(() => null);
    if (group && group.media && group.media.fileId) [kind, fileId] = [group.media.kind, group.media.fileId];
  }
  let media = null;
  if (fileId) {
    try {
      media = { kind, buffer: await tg.downloadFile(fileId) };
    } catch (err) {
      notes.push(`файл рекламы не скачать (${err.message})`);
    }
  }

  let card = null;
  if (!media) {
    if (campaign && campaign.media_kind === 'card' && campaign.card) {
      card = typeof campaign.card === 'string' ? JSON.parse(campaign.card) : campaign.card;
    } else if (listing.parsed) {
      card = { parsed: listing.parsed, listingType: listing.parsed.listing_type || 'board' };
    }
  }
  return { campaign, media, card, notes };
}

// deps: { report(chatId, text), siteLink(listing) } — из bot.js; to — куда
// поднимать, из настроек (читает их заход, один раз на все поднятия).
async function raiseOne(row, deps, to) {
  const listing = await imports.get(row.import_id);
  if (!listing || listing.status !== 'published') {
    await cancel(row.import_id);
    await finish(row, 'cancelled', { note: 'рекламу сняли' });
    return;
  }

  const result = { note: null };
  const text = listing.raw_text || '';

  if (to.site) result.site = await imports.bump(listing).catch(() => false);

  if (to.threads || to.instagram) {
    const { campaign, media, card, notes } = await payload(listing);
    if (notes.length) result.note = notes.join('; ');
    const shared = await social.raiseAd({
      text,
      threadsText: campaign ? campaign.threads_text : '',
      media,
      card,
      siteLink: deps.siteLink(listing),
      threads: to.threads,
      instagram: to.instagram,
    });
    result.threads = brief(shared.threads);
    result.instagram = brief(shared.instagram);
    // Пост поднятия — в ту же кампанию: просмотры сложатся в отчёте.
    if (shared.threads && shared.threads.posted && campaign) {
      await social.adTracker.addPost(campaign.id, shared.threads.id).catch(() => {});
    }
  }

  if (to.groups) {
    const groups = await adGroups.repeat({ importId: listing.id, chatId: row.chat_id, text }).catch((err) => ({
      queued: 0,
      reason: err.message,
    }));
    result.groups = groups.silent ? null : { queued: groups.queued || 0, reason: groups.reason || null };
  }

  const ok =
    result.site === true ||
    Boolean(result.threads && result.threads.posted) ||
    Boolean(result.instagram && result.instagram.posted) ||
    Boolean(result.groups && result.groups.queued);
  await finish(row, ok ? 'done' : 'failed', result);
  feedStats.bump(ok ? 'raise.ok' : 'raise.fail');

  const title = tg.esc(clamp((listing.parsed && listing.parsed.title) || 'реклама', 60));
  if (!ok) {
    await deps.report(row.chat_id, [`⚠️ Поднятие «${title}» не вышло нигде:`, ...failLines(result)].join('\n'));
  }
  await reportIfLast(row, listing, title, deps);
}

function failLines(result) {
  const lines = [];
  if (result.site === false) lines.push('• сайт: карточку не поднять');
  if (result.threads && !result.threads.posted) lines.push(`• Threads: ${tg.esc(result.threads.reason || '')}`);
  if (result.instagram && !result.instagram.posted) lines.push(`• Instagram: ${tg.esc(result.instagram.reason || '')}`);
  if (result.groups && !result.groups.queued) lines.push(`• группы: ${tg.esc(result.groups.reason || '')}`);
  if (result.note) lines.push(`• ${tg.esc(result.note)}`);
  return lines;
}

// Последнее поднятие рекламы — итог одним сообщением: его можно переслать
// рекламодателю.
async function reportIfLast(row, listing, title, deps) {
  const list = await rows(row.import_id);
  const summary = summarize(list);
  if (summary.pending) return;
  const results = list
    .filter((r) => r.status !== 'cancelled')
    .map((r) => (typeof r.result === 'string' ? JSON.parse(r.result) : r.result) || {});
  const count = (fn) => results.filter(fn).length;
  const lines = [`🔁 Поднятия «${title}» закончились: ${summary.done} из ${summary.total}.`];
  const threads = count((r) => r.threads && r.threads.posted);
  const instagram = count((r) => r.instagram && r.instagram.posted);
  const groups = results.reduce((sum, r) => sum + ((r.groups && r.groups.queued) || 0), 0);
  const site = count((r) => r.site === true);
  if (site) lines.push(`🌐 На сайте поднята ${site} ${plural(site, ['раз', 'раза', 'раз'])}`);
  if (threads) lines.push(`🧵 Threads: ${threads} ${plural(threads, ['пост', 'поста', 'постов'])}`);
  if (instagram) lines.push(`📸 Instagram: ${instagram} ${plural(instagram, ['пост', 'поста', 'постов'])}`);
  if (groups) lines.push(`👥 Группы Telegram: ${groups} ${plural(groups, ['пост', 'поста', 'постов'])}`);
  await deps.report(row.chat_id, lines.join('\n'));
}

// Один заход: все созревшие поднятия. Каждое — своим ходом, и заход их не
// ждёт: ответа Threads можно ждать десятки минут, и поднятия, созревшие за это
// время, не должны стоять за ним, пока не опоздают. Взятое помечено running —
// второй раз его не возьмут. done — когда все взятые закончатся (для тестов).
async function tick(deps, now = Date.now()) {
  const { rows: due } = await db.query(
    `UPDATE ad_raises SET status = 'running'
      WHERE id IN (SELECT id FROM ad_raises WHERE status = 'pending' AND due_at <= NOW()
                   ORDER BY due_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
      RETURNING *`
  );
  const { to } = due.length ? await settings() : DEFAULT_PLAN;
  const runs = due.map(async (row) => {
    try {
      if (now - new Date(row.due_at).getTime() > LATE_MS) {
        await finish(row, 'skipped', { note: 'в это время сервер не работал' });
        return;
      }
      await raiseOne(row, deps, to);
    } catch (err) {
      console.error('[поднятия]', err);
      await finish(row, 'failed', { note: err.message }).catch(() => {});
    }
  });
  return { count: due.length, done: Promise.all(runs) };
}

// Поднятие, которое перезапуск оборвал на середине, повторять нельзя: часть
// площадок его уже получила. Отмечаем и идём дальше.
async function recover() {
  await db.query(
    `UPDATE ad_raises SET status = 'failed', done_at = NOW(),
            result = jsonb_build_object('note', 'перезапуск посреди поднятия')
      WHERE status = 'running'`
  );
}

function start(deps) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await tick(deps);
    } catch (err) {
      console.error('[поднятия] заход:', err.message);
    } finally {
      busy = false;
    }
  };
  recover()
    .catch((err) => console.error('[поднятия] восстановление:', err.message))
    .finally(() => {
      setInterval(run, TICK_MS).unref();
      run();
    });
}

module.exports = {
  settings,
  setDays,
  setTimes,
  toggle,
  active,
  slots,
  plan,
  rows,
  summarize,
  cancel,
  extend,
  restart,
  tick,
  start,
  DAY_OPTIONS,
  TIME_PRESETS,
  DEFAULT_PLAN,
};

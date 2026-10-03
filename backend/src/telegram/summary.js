const tg = require('./api');
const extract = require('./extract');
const queue = require('./queue');
const feedStats = require('./feedStats');
const social = require('../social');
const { num, plural, viewsWord, clamp, clock } = require('./format');

// Сводка в Telegram вместо потока «кто что опубликовал».
//
// Посты из групп бот публикует молча (см. quiet в bot.js), а сюда собирает
// итог: сколько вышло и каких, сколько отсеяно и почему, как идёт реклама и
// что с площадками. Приходит сама в часы из SUMMARY_HOURS и по /stats.

const HOUR_MS = 60 * 60 * 1000;

// Часы сводки по Бишкеку. Ночью сервис спит (см. keepalive.js), так что
// ставить их туда бесполезно. SUMMARY_HOURS=off — только по /stats.
function parseHours(value) {
  const raw = String(value ?? '9,13,17,21').trim();
  if (!raw || raw === 'off') return [];
  return [...new Set(raw.split(',').map((s) => Number(s.trim())).filter((h) => Number.isInteger(h) && h >= 0 && h < 24))].sort(
    (a, b) => a - b
  );
}
const HOURS = parseHours(process.env.SUMMARY_HOURS);

const bishkekHour = (now = Date.now()) => new Date(now + 6 * HOUR_MS).getUTCHours();

// Короткое имя модели для строки в чате: «qwen3.8-27b», а не «qwen/qwen3.8-27b».
const shortModel = (model) => String(model).split('/').pop();

// Лесенка моделей одной строкой: что работает, что выбрано и до какого часа,
// что пропало совсем (см. modelLadder в extract.js).
function modelLines(models) {
  if (!models || !models.length) return [];
  const parts = models.map((m) => {
    const name = `${shortModel(m.model)}${m.reserve ? ' (резерв)' : ''}`;
    if (m.gone) return `${name} ✖ пропала`;
    if (m.until) return `${name} ⏳ до ${clock(m.until)}`;
    return `${name} ✅`;
  });
  return [`🪜 Модели: ${parts.join(' · ')}`];
}

// Резерв «в деле»: все модели, кроме последней, выбраны или пропали.
function reserveOnly(models) {
  if (!models || models.length < 2) return false;
  const regular = models.slice(0, -1);
  const reserve = models[models.length - 1];
  return regular.every((m) => m.gone || m.until) && !reserve.gone && !reserve.until;
}


// Почему посты из групп не вышли — в том порядке, в каком это интересно:
// сначала то, что фильтр поймал по делу, потом обычный шум.
const CUT_REASONS = [
  ['grp.no.mlm', 'сетевой маркетинг'],
  ['grp.no.drop', 'чужие документы'],
  ['grp.no.recruit', 'вербовка'],
  ['grp.no.abroad', 'заграница'],
  ['grp.blocked', 'номер в чёрном списке'],
  ['grp.dup', 'повторы'],
  ['grp.no.other', 'не объявление'],
  ['grp.nophone', 'без номера'],
];

// Реклама за последние сутки: сколько набрала и что с гарантией. Кампании,
// которые ещё не отчитались, показываем, даже если им больше суток.
async function adLines(todayCount) {
  const tracker = social.adTracker;
  const lines = ['📣 Реклама'];
  let campaigns = [];
  try {
    campaigns = (await tracker.recent(2)).filter(
      (c) => !c.reported_at || tracker.ageOf(c) < tracker.REPORT_AFTER_MS + 2 * HOUR_MS
    );
  } catch (err) {
    console.error('[сводка] рекламу не прочитать:', err.message);
  }
  lines.push(`Сегодня выложено: ${num(todayCount)}`);

  for (const [i, campaign] of campaigns.slice(0, 6).entries()) {
    let totals;
    try {
      ({ totals } = await tracker.refresh(campaign));
    } catch {
      totals = tracker.totalsOf(await tracker.postsOf(campaign.id).catch(() => []));
    }
    const goal = Number(campaign.goal) || tracker.GOAL;
    const hours = Math.max(1, Math.round(tracker.ageOf(campaign) / HOUR_MS));
    const status =
      totals.views >= goal ? '✅' : campaign.reported_at ? `⚠️ недобор ${num(goal - totals.views)}` : `⏳ ${hours} ч`;
    lines.push(
      `${i + 1}. «${tg.esc(clamp(campaign.title, 40))}» — 👁 ${num(totals.views)} ${viewsWord(totals.views)} ${status}`
    );
  }
  if (!campaigns.length && !todayCount) lines.push('За сутки рекламы не было.');

  try {
    const week = await tracker.summary(7);
    if (week.reported) lines.push(`За неделю гарантию ${num(tracker.GOAL)}+ набрали ${week.met} из ${week.reported}`);
  } catch {
    // нет — так нет: это строка для справки
  }
  return lines;
}

// Технические строки — только в /stats: в сводке по расписанию они шум, а
// когда бот замолчал, именно по ним видно почему.
function techLines() {
  const byType = social.queuedByType();
  const waitingLine = byType.length
    ? byType.map((q) => `${social.collectionTitle(q.listingType).toLowerCase()} ${q.count}`).join(', ')
    : 'пусто';
  return [
    ...(queue.stalled() ? [`⚠️ Зависших разборов: ${queue.stalled()} — запрос ушёл и не вернулся`] : []),
    ...(queue.size() ? [`📥 Ждут разбора: ${queue.size()}`] : []),
    `🎬 Роликов в работе: ${social.pending()}`,
    `⏳ Ждут ролика: ${waitingLine} (до ${social.BATCH_SIZE} в ролике, выпуск раз в ${social.RELEASE_INTERVAL_MIN} мин)`,
    `🧵 Ждут очереди в Threads: ${social.threadsQueued()}`,
    `📸 Публикаций в Instagram за сутки: ${social.quota.used()} из ${
      social.quota.used() >= social.quota.dailyLimit()
        ? `${social.quota.hardLimit()} (ролики закончились, идут картинки)`
        : social.quota.dailyLimit()
    }`,
  ];
}

// Сводка целиком. previous — сколько вышло из групп к прошлой сводке: по нему
// строка «+12 с прошлой сводки». extra — строки, которые знает только бот
// (отложенные объявления).
async function build({ now = Date.now(), previous = null, tech = false, title = null, extra = [] } = {}) {
  const c = await feedStats.day(feedStats.today(now)).catch((err) => {
    console.error('[сводка] счётчики не прочитать:', err.message);
    return {};
  });
  const n = (key) => c[key] || 0;
  const grpOk = n('grp.ok.vacancy') + n('grp.ok.order') + n('grp.ok.board');
  const published = grpOk + n('adm.ok') + n('ad.ok');

  const lines = [title || `📊 Сводка за сегодня, ${clock(now)}`, `Сегодня опубликовано: ${num(published)}`, ''];

  lines.push('📥 Из групп');
  const delta = previous !== null && grpOk >= previous ? ` (+${num(grpOk - previous)} с прошлой сводки)` : '';
  lines.push(
    `Вышло: ${num(grpOk)}${delta}${
      grpOk ? ` — 💼 ${num(n('grp.ok.vacancy'))} · 🧰 ${num(n('grp.ok.order'))} · 📌 ${num(n('grp.ok.board'))}` : ''
    }`
  );
  // Сколько из вышедшего сегодня — для студентов (из групп, руками и рекламой).
  if (n('students')) lines.push(`🎓 Для студентов: ${num(n('students'))}`);
  const cut = CUT_REASONS.map(([key, label]) => [label, n(key)]).filter(([, v]) => v);
  const cutTotal = cut.reduce((sum, [, v]) => sum + v, 0);
  if (cutTotal) lines.push(`Отсеял: ${num(cutTotal)} — ${cut.map(([label, v]) => `${label} ${num(v)}`).join(' · ')}`);
  if (n('grp.stale')) lines.push(`Устарели, пока ждали разбора: ${num(n('grp.stale'))}`);
  if (n('grp.fail')) {
    const last = feedStats.lastFailure();
    lines.push(
      `⚠️ Не вышло: ${num(n('grp.fail'))}${last ? ` — последняя ошибка: ${tg.esc(clamp(last.message, 150))}` : ''}`
    );
  }
  if (n('adm.ok')) lines.push('', `✍️ Прислано вручную: ${num(n('adm.ok'))}`);

  lines.push('', ...(await adLines(n('ad.ok'))));
  // Реклама в группах Telegram (см. adGroups.js): постов, а не реклам — одна
  // реклама уходит в несколько групп.
  if (n('adgrp.ok') || n('adgrp.fail')) {
    lines.push(
      `👥 В группах Telegram: ${num(n('adgrp.ok'))} ${plural(n('adgrp.ok'), ['пост', 'поста', 'постов'])}${
        n('adgrp.fail') ? ` · не ушло ${num(n('adgrp.fail'))}` : ''
      }`
    );
  }

  lines.push(
    '',
    '📲 Площадки',
    `🧵 Threads: ${num(n('th.ok'))}${n('th.fail') ? ` · не вышло ${num(n('th.fail'))}` : ''}`,
    `📸 Instagram: роликов ${num(n('ig.reel'))}, картинкой ${num(n('ig.image'))}${
      n('ig.fail') ? ` · не вышло ${num(n('ig.fail'))}` : ''
    }`
  );

  // Разборы считаются в памяти процесса — после перезапуска Render с нуля.
  const groq = extract.usage();
  const k = (v) => `${Math.round(v / 1000)}к`;
  lines.push(
    '',
    `🧠 Разборов с перезапуска: ${num(groq.calls)}, токенов ≈${k(groq.tokens)}${groq.keys > 1 ? ` (${groq.keys} ключа)` : ''}`,
    ...modelLines(groq.models),
    ...(reserveOnly(groq.models) ? ['🅰️ Обычные модели выбраны — посты из групп жду, последнюю берегу под рекламу'] : []),
    ...extra
  );
  if (tech) lines.push(...techLines());

  return { text: lines.join('\n'), grpOk };
}

// Отправить сводку, если пришёл её час и в этот час её ещё не было. Отметку
// держим в базе: после перезапуска в тот же час вторая сводка не нужна.
let sentKey = null;
const SETTING = 'summary:last';

async function tick(send, { now = Date.now(), extra = () => [] } = {}) {
  const hour = bishkekHour(now);
  if (!HOURS.includes(hour)) return false;
  const day = feedStats.today(now);
  const key = `${day}:${hour}`;
  if (sentKey === key) return false;

  let stored = null;
  try {
    stored = JSON.parse((await feedStats.getSetting(SETTING)) || 'null');
  } catch {
    stored = null;
  }
  if (stored && stored.key === key) {
    sentKey = key;
    return false;
  }
  // Отметку в памяти ставим до отправки: сводка собирается секунды (просмотры
  // рекламы спрашиваем у Threads), и следующий обход не должен прислать
  // вторую. Не ушла — снимаем: попробуем на следующем обходе.
  sentKey = key;
  try {
    const last = hour === HOURS[HOURS.length - 1];
    const { text, grpOk } = await build({
      now,
      previous: stored && stored.day === day ? stored.grpOk : null,
      title: last ? `📊 Итог дня, ${clock(now)}` : null,
      extra: extra(),
    });
    await send(text);
    await feedStats.setSetting(SETTING, JSON.stringify({ key, day, grpOk })).catch((err) =>
      console.error('[сводка] отметку не записать:', err.message)
    );
  } catch (err) {
    sentKey = null;
    throw err;
  }
  return true;
}

let timer = null;

// send(text) — куда слать, решает бот. Обход раз в пять минут: сводка
// опаздывает на минуты, зато таймер не надо пересчитывать после сна сервиса.
function start(send, opts = {}) {
  if (timer || !HOURS.length) return;
  timer = setInterval(() => tick(send, opts).catch((err) => console.error('[сводка]', err)), 5 * 60 * 1000);
  timer.unref();
  console.log(`[сводка] в ${HOURS.map((h) => `${h}:00`).join(', ')} по Бишкеку`);
}

module.exports = { build, tick, start, parseHours, modelLines, reserveOnly, clock, num, viewsWord, HOURS };

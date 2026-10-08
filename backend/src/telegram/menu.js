const tg = require('./api');
const { num, plural, viewsWord, clamp, clock, whenText, agoText } = require('./format');

// Меню бота: кнопки вместо того, чтобы помнить полтора десятка команд.
//
// Команды остались — /stats, /ads и прочие работают как раньше, — но теперь до
// всего можно дойти кнопками: внизу экрана четыре главных (реклама, сводка,
// посты из групп, меню), а «☰ Меню» открывает остальное. Разделы открываются
// в том же сообщении, без новой простыни в чате, и у каждого есть «☰ Меню»
// обратно.
//
// Здесь только тексты и кнопки — из готовых данных. Данные собирает бот
// (bot.js): так экраны можно проверить без базы и без Telegram.

const HOUR_MS = 60 * 60 * 1000;
const PAGE_SIZE = 6;

const keyboard = (rows) => ({ reply_markup: { inline_keyboard: rows } });
const BACK = { text: '☰ Меню', callback_data: 'm:home' };

// Кнопки внизу экрана. Нажатие присылает их текст обычным сообщением — по нему
// бот и понимает, что открыть.
const KEYS = { '📣 Реклама': 'ads', '📊 Сводка': 'stats', '📥 Из групп': 'last', '☰ Меню': 'home' };
const KEYBOARD = {
  reply_markup: {
    keyboard: [[{ text: '📣 Реклама' }, { text: '📊 Сводка' }], [{ text: '📥 Из групп' }, { text: '☰ Меню' }]],
    resize_keyboard: true,
    is_persistent: true,
  },
};

// Список у синей кнопки «Меню» рядом с полем ввода (setMyCommands).
const COMMANDS = [
  { command: 'menu', description: 'Меню с кнопками' },
  { command: 'ad', description: 'Платная реклама: пришлите её следом' },
  { command: 'ad_fast', description: 'Реклама сразу, без разбора' },
  { command: 'ads', description: 'Вся реклама и её просмотры' },
  { command: 'products', description: 'Мои продукты: свои посты по расписанию' },
  { command: 'stats', description: 'Сводка за сегодня' },
  { command: 'last', description: 'Всё опубликованное: из групп и ваше' },
  { command: 'spam', description: 'Что отсеяно как мусор' },
  { command: 'groups', description: 'Группы для рекламы' },
  { command: 'threads', description: 'Статистика Threads' },
  { command: 'limits', description: 'Лимиты Instagram и Threads' },
  { command: 'top', description: 'Ролик-подборка с сайта' },
  { command: 'now', description: 'Выпустить очередь роликов' },
  { command: 'dm', description: 'Директ Threads' },
  { command: 'help', description: 'Справка' },
];

function homeView() {
  return {
    text: '☰ <b>Меню</b>\nЧто открыть?',
    extra: keyboard([
      [
        { text: '📣 Реклама', callback_data: 'm:ads' },
        { text: '📊 Сводка', callback_data: 'm:stats' },
      ],
      [
        { text: '🛍 Мои продукты', callback_data: 'm:products' },
        { text: '🔁 Поднятия рекламы', callback_data: 'm:raise' },
      ],
      [
        { text: '📥 Опубликованное', callback_data: 'm:last' },
        { text: '🧹 Отсеянное', callback_data: 'm:spam' },
      ],
      [
        { text: '👥 Группы для рекламы', callback_data: 'm:groups' },
        { text: '🧵 Threads', callback_data: 'm:threads' },
      ],
      [
        { text: '📏 Лимиты', callback_data: 'm:limits' },
        { text: '🤖 Директ', callback_data: 'm:dm' },
      ],
      [
        { text: '🎬 Подборка с сайта', callback_data: 'm:top' },
        { text: '⏩ Выпустить очередь', callback_data: 'm:now' },
      ],
      [
        { text: '➕ Как дать рекламу', callback_data: 'm:adhow' },
        { text: '❓ Справка', callback_data: 'm:help' },
      ],
    ]),
  };
}

// Готовый отчёт (сводка, /last, /dm) — с кнопкой обратно в меню под его
// собственными кнопками.
function withBack(view) {
  const extra = view.extra || {};
  const rows = (extra.reply_markup && extra.reply_markup.inline_keyboard) || [];
  return { text: view.text, extra: { ...extra, reply_markup: { inline_keyboard: [...rows, [BACK]] } } };
}

function ageLabel(at, now) {
  const ms = now - new Date(at).getTime();
  return ms < 24 * HOUR_MS ? agoText(ms) : whenText(at);
}

const hoursText = (ms) => (ms < HOUR_MS ? `${Math.max(1, Math.round(ms / 60000))} мин` : `${Math.round(ms / HOUR_MS)} ч`);

// Значок гарантии: набрала, недобрала к отчёту, ещё идёт.
const mark = (views, goal, reported) => (views >= goal ? '✅' : reported ? '⚠️' : '⏳');

// «📣 Реклама»: сначала новая, по шесть на страницу. Под каждой — кнопка «ℹ️»
// с подробностями.
function adsListView({ rows, page = 0, pages = 1, total = 0, goal = 1000, now = Date.now() }) {
  if (!rows.length) {
    return {
      text: ['📣 <b>Реклама</b>', '', 'Рекламы ещё не было.', 'Как выложить — ☰ Меню → ➕ Как дать рекламу.'].join('\n'),
      extra: keyboard([[BACK]]),
    };
  }
  const lines = [`📣 <b>Реклама</b> — сначала новая · всего ${num(total)}`];
  if (pages > 1) lines.push(`Страница ${page + 1} из ${pages}`);
  const buttons = [];
  rows.forEach((row, i) => {
    const n = page * PAGE_SIZE + i + 1;
    const title = (row.parsed && row.parsed.title) || 'реклама';
    const removed = row.status !== 'published' ? ' · 🗑 снята' : '';
    lines.push('', `${n}. «${tg.esc(clamp(title, 60))}» · ${ageLabel(row.published_at || row.created_at, now)}${removed}`);
    const target = Number(row.goal) || goal;
    const threads = row.campaign_id
      ? `🧵 👁 ${num(row.views)} из ${num(target)} ${mark(row.views, target, row.reported_at)}`
      : '🧵 в Threads ещё не выходила';
    const groups = row.groups_total ? ` · 👥 ${row.groups_sent} из ${row.groups_total}` : '';
    lines.push(`     ${threads}${groups}`);
    buttons.push([{ text: `ℹ️ ${n}. ${clamp(title, 32)}`, callback_data: `ai:${row.id}:${page}` }]);
  });
  lines.push('', 'Нажмите на рекламу — покажу просмотры в Threads, где она вышла и отчёт.');
  const nav = [];
  if (page > 0) nav.push({ text: '⬅️ Новее', callback_data: `al:${page - 1}` });
  if (page < pages - 1) nav.push({ text: 'Старее ➡️', callback_data: `al:${page + 1}` });
  return { text: lines.join('\n'), extra: keyboard([...buttons, ...(nav.length ? [nav] : []), [BACK]]) };
}

const BAR = 10;
function bar(views, goal) {
  const filled = Math.max(0, Math.min(BAR, Math.round((views / Math.max(1, goal)) * BAR)));
  return '▰'.repeat(filled) + '▱'.repeat(BAR - filled);
}

const TYPE_NAMES = { vacancy: '💼 Вакансия', order: '🧰 Заказ', board: '📌 Записка на доске' };

function groupLine(row, now) {
  const title = tg.esc(clamp(row.title || row.target, 40));
  const name = row.link ? `<a href="${row.link}">${title}</a>` : title;
  const note = row.note ? ` — ${tg.esc(row.note)}` : '';
  if (row.status === 'sent') {
    const views = typeof row.views === 'number' ? ` · 👁 ${num(row.views)}` : '';
    return `✅ ${name} · ${clock(row.sent_at)}${views}${note}`;
  }
  if (row.status === 'pending') return `⏳ ${name} · ≈ ${clock(Math.max(now, new Date(row.not_before).getTime()))}${note}`;
  if (row.status === 'deleted') return `🗑 ${name} — удалено вместе с рекламой`;
  if (row.status === 'failed') return `⚠️ ${name} — ${tg.esc(row.note || 'не ушло')}`;
  return `⏭ ${name} — ${tg.esc(row.note || 'пропущено')}`;
}

// «ℹ️» по одной рекламе: где вышла, сколько набрала в Threads, что с группами.
function adInfoView({
  ad,
  campaign = null,
  posts = [],
  totals = null,
  denied = false,
  groups = [],
  channel = null,
  siteLink = '',
  siteLabel = '',
  page = 0,
  boostable = false,
  goal = 1000,
  reportAfterMs = 24 * HOUR_MS,
  raises = null,
  now = Date.now(),
}) {
  const p = ad.parsed || {};
  const at = ad.published_at || ad.created_at;
  const lines = [`📣 <b>${tg.esc(clamp(p.title || 'реклама', 100))}</b>`, `Вышла ${whenText(at)} · ${agoText(now - new Date(at).getTime())}`];
  const type = ad.vacancy_id ? 'vacancy' : ad.order_id ? 'order' : ad.board_post_id ? 'board' : null;
  if (ad.status !== 'published') lines.push('🗑 Снята с сайта');
  else if (type) {
    lines.push(`${TYPE_NAMES[type]} на сайте${siteLink ? `: <a href="${siteLink}">${tg.esc(siteLabel || siteLink)}</a>` : ''}`);
  }
  if (p.for_students) lines.push('🎓 Для студентов');

  lines.push('', '🧵 <b>Threads</b>');
  if (!campaign) {
    lines.push('Ещё не вышла: пост ждёт очереди или Threads не настроен.');
  } else {
    const target = Number(campaign.goal) || goal;
    const t = totals || { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, shares: 0 };
    lines.push(`👁 ${num(t.views)} из ${num(target)} ${bar(t.views, target)} ${mark(t.views, target, campaign.reported_at)}`);
    lines.push(`❤️ ${num(t.likes)} · 💬 ${num(t.replies)} · 🔁 ${num(t.reposts + t.quotes)} · ↗️ ${num(t.shares)}`);
    const parts = posts.map((post, i) => {
      const label = i === 0 ? 'первый пост' : `повтор ${i}`;
      return `${post.permalink ? `<a href="${post.permalink}">${label}</a>` : label} — 👁 ${num(post.views)}`;
    });
    if (parts.length > 1) lines.push(parts.join(' · '));
    else if (posts[0] && posts[0].permalink) lines.push(`<a href="${posts[0].permalink}">Открыть пост</a>`);
    if (campaign.reported_at) {
      lines.push(`Отчёт за сутки отправлен ${whenText(campaign.reported_at)}`);
    } else {
      const left = new Date(campaign.created_at).getTime() + reportAfterMs - now;
      lines.push(left > 0 ? `Отчёт за сутки — через ${hoursText(left)}` : 'Отчёт за сутки — вот-вот');
    }
    if (denied) lines.push('⚠️ Свежих чисел нет: у токена Threads нет разрешения threads_manage_insights.');
  }

  if (typeof channel === 'number') lines.push('', `📢 Наш канал: 👁 ${num(channel)} ${viewsWord(channel)}`);

  if (groups.length) {
    const latest = latestByGroup(groups);
    const reached = latest.filter((g) => g.sent).length;
    lines.push('', `👥 <b>Группы Telegram</b> — ${reached} из ${latest.length}`);
    for (const g of latest) lines.push(`${groupLine(g.row, now)}${g.sent > 1 ? ` · вышла ${g.sent} ${plural(g.sent, ['раз', 'раза', 'раз'])}` : ''}`);
    if (groups.some((g) => g.status === 'sent') && !groups.some((g) => typeof g.views === 'number')) {
      lines.push('Просмотры в группах Telegram не считает — только в каналах.');
    }
  } else {
    lines.push('', '👥 В группы Telegram не уходила.');
  }

  lines.push('', `🔁 <b>Поднятия</b>: ${raiseSummaryText(raises)}`);

  const top = [{ text: '🔄 Обновить', callback_data: `ai:${ad.id}:${page}:f` }];
  if (boostable && campaign) top.push({ text: '🔁 Поднять в Threads', callback_data: `ib:${campaign.id}:${ad.id}:${page}` });
  const mid = [{ text: '🔁 Поднятия', callback_data: `rz:v:${ad.id}:${page}` }];
  if (campaign) mid.push({ text: '📄 Отчёт для рекламодателя', callback_data: `ar:${campaign.id}` });
  if (ad.status === 'published') mid.push({ text: '🗑 Снять', callback_data: `ax:${ad.id}:${page}` });
  return {
    text: lines.join('\n'),
    extra: keyboard([top, ...(mid.length ? [mid] : []), [{ text: '⬅️ К списку', callback_data: `al:${page}` }, BACK]]),
  };
}

// ─── Поднятия рекламы (см. adRaises.js)

const PLATFORM_NAMES = { site: '🌐 сайт', threads: '🧵 Threads', instagram: '📸 Instagram', groups: '👥 группы Telegram' };
const PLATFORM_KEYS = { site: 'Сайт', threads: 'Threads', instagram: 'Instagram', groups: 'Группы' };
const RAISE_PLATFORMS = ['site', 'threads', 'instagram', 'groups'];

const timesText = (times) =>
  times.length > 1 ? `${times.slice(0, -1).join(', ')} и ${times[times.length - 1]}` : times[0] || '';
const daysText = (days) => `${days} ${plural(days, ['день', 'дня', 'дней'])}`;

// Строка плана для отчёта о публикации и для экрана настроек.
function raisePlanText(plan) {
  const count = plan.days * plan.times.length;
  const where = RAISE_PLATFORMS.filter((k) => plan.to[k]).map((k) => PLATFORM_NAMES[k]);
  return `${count} ${plural(count, ['поднятие', 'поднятия', 'поднятий'])}: ${
    plan.days === 1 ? 'завтра' : `${daysText(plan.days)} подряд с завтрашнего`
  } в ${timesText(plan.times)} — ${where.join(', ')}`;
}

// «☰ Меню → 🔁 Поднятия рекламы»: план для новой рекламы.
function raiseSettingsView(plan, { dayOptions, timePresets, active }) {
  const lines = ['🔁 <b>Поднятия рекламы</b>'];
  if (active) {
    lines.push('Новая платная реклама после выхода поднимается сама:', raisePlanText(plan) + '.');
  } else {
    lines.push('Сейчас выключены: новая реклама сама не поднимается.');
  }
  lines.push(
    '',
    'Поднятие — та же реклама ещё раз: на сайте карточка снова наверху, в Threads и Instagram — новый пост, в группы — ещё раз через ту же очередь с паузами.',
    'Время — по Бишкеку. Настройки действуют на новую рекламу; у вышедшей план меняется в «📣 Реклама» → «ℹ️» → «🔁 Поднятия».'
  );
  if (active && plan.to.groups && plan.times.length > 1) {
    lines.push('', '⚠️ Одна реклама в группе по нескольку раз в день — админы групп могут счесть это спамом и выгнать.');
  }
  const mark = (on) => (on ? '✅ ' : '');
  const days = dayOptions.map((d) => ({
    text: `${mark(plan.days === d)}${d ? d : 'Выкл'}`,
    callback_data: `rs:d:${d}`,
  }));
  const times = timePresets.map((preset, i) => ({
    text: `${mark(preset.join() === plan.times.join())}${timesText(preset)}`,
    callback_data: `rs:t:${i}`,
  }));
  const platforms = RAISE_PLATFORMS.map((k) => ({
    text: `${plan.to[k] ? '✅' : '⬜'} ${PLATFORM_KEYS[k]}`,
    callback_data: `rs:p:${k}`,
  }));
  return {
    text: lines.join('\n'),
    extra: keyboard([
      [{ text: 'Сколько дней:', callback_data: 'rs:noop' }],
      days,
      ...times.map((b) => [b]),
      platforms.slice(0, 2),
      platforms.slice(2),
      [BACK],
    ]),
  };
}

const parseResult = (r) => (typeof r.result === 'string' ? JSON.parse(r.result) : r.result) || {};

function raiseLine(r) {
  const at = whenText(r.due_at);
  const res = parseResult(r);
  if (r.status === 'pending') return `⏳ ${at}`;
  if (r.status === 'running') return `🔄 ${at} — идёт`;
  if (r.status === 'skipped') return `⏭ ${at} — пропущено: ${tg.esc(res.note || '')}`;
  if (r.status === 'failed') return `⚠️ ${at} — не вышло${res.note ? `: ${tg.esc(res.note)}` : ''}`;
  const parts = [];
  if (res.site === true) parts.push('сайт');
  if (res.threads) parts.push(res.threads.posted ? 'Threads' : 'Threads ✗');
  if (res.instagram) parts.push(res.instagram.posted ? 'Instagram' : 'Instagram ✗');
  if (res.groups) parts.push(res.groups.queued ? `группы: ${res.groups.queued}` : 'группы ✗');
  return `✅ ${at} — ${parts.join(' · ')}`;
}

// Строка про поднятия в карточке рекламы.
function raiseSummaryText(s) {
  if (!s || !s.total) return s && s.stopped ? 'остановлены' : 'не запланированы';
  const head = `${s.done} из ${s.total}`;
  if (s.next) return `${head} · следующее — ${whenText(s.next)}`;
  if (s.stopped) return `${head} · остановлены`;
  return `${head} · закончились`;
}

// План поднятий одной рекламы: что сделано, что ждёт, и кнопки.
function raisesView({ ad, list, summary, page = 0 }) {
  const title = (ad.parsed && ad.parsed.title) || 'реклама';
  const live = list.filter((r) => r.status !== 'cancelled');
  const lines = [`🔁 <b>Поднятия «${tg.esc(clamp(title, 60))}»</b>`, raiseSummaryText(summary)];
  if (live.length) lines.push('', ...live.map(raiseLine));
  const cancelled = list.length - live.length;
  if (cancelled) lines.push('', `Отменено: ${cancelled}`);
  const rows = [];
  if (summary.pending) rows.push([{ text: '⏹ Остановить', callback_data: `rz:s:${ad.id}:${page}` }]);
  if (ad.status === 'published') {
    rows.push([
      { text: '➕ Ещё день', callback_data: `rz:e:${ad.id}:${page}` },
      { text: '🔄 Заново по настройкам', callback_data: `rz:r:${ad.id}:${page}` },
    ]);
  }
  rows.push([{ text: '⬅️ К рекламе', callback_data: `ai:${ad.id}:${page}` }, BACK]);
  return { text: lines.join('\n'), extra: keyboard(rows) };
}

// После поднятий у одной группы несколько постов одной рекламы: показываем
// последний и сколько всего вышло, иначе карточка разрасталась бы на десятки
// строк и упиралась в 4096 знаков.
function latestByGroup(groups) {
  const byTarget = new Map();
  for (const row of groups) {
    const entry = byTarget.get(row.target) || { row, sent: 0 };
    entry.row = row;
    if (row.status === 'sent' || row.status === 'deleted') entry.sent += 1;
    byTarget.set(row.target, entry);
  }
  return [...byTarget.values()];
}

// ─── «📥 Из групп» (/last): всё опубликованное, по десять на страницу

const PUBLISHED_PAGE = 10;
const PUBLISHED_TABS = {
  groups: { tab: 'Из групп', title: '📥 <b>Из групп</b>', empty: 'Из групп ещё ничего не выходило.' },
  mine: { tab: 'Мои', title: '✍️ <b>Присланное вами</b>', empty: 'Вы ещё ничего не присылали.' },
  all: { tab: 'Всё', title: '📋 <b>Всё опубликованное</b>', empty: 'Ещё ничего не выходило.' },
};
const TYPE_ICONS = { vacancy: '💼', order: '🧰', board: '📌' };

const rowsOf = (buttons, size = 5) => {
  const out = [];
  for (let i = 0; i < buttons.length; i += size) out.push(buttons.slice(i, i + size));
  return out;
};

// rows — из imports.listPublished; type и url (только у того, что ещё на
// сайте) добавляет бот. Кнопки 🗑 и 🚫 — ldel и lspm: отчёт о снятии приходит
// отдельным сообщением, а список остаётся как был — по нему снимают дальше.
function publishedView({ rows, from = 'groups', page = 0, pages = 1, total = 0, blockDays = 30, now = Date.now() }) {
  const tab = PUBLISHED_TABS[from] || PUBLISHED_TABS.groups;
  const tabs = Object.entries(PUBLISHED_TABS).map(([key, t]) => ({
    text: `${key === from ? '✅ ' : ''}${t.tab}`,
    callback_data: `lp:${key}:0`,
  }));
  if (!rows.length) return { text: `${tab.title}\n\n${tab.empty}`, extra: keyboard([tabs, [BACK]]) };

  const lines = [`${tab.title} — сначала новое · всего ${num(total)}`];
  if (pages > 1) lines.push(`Страница ${page + 1} из ${pages}`);
  lines.push('');
  const del = [];
  const junk = [];
  rows.forEach((row, i) => {
    const n = page * PUBLISHED_PAGE + i + 1;
    const p = row.parsed || {};
    const title = tg.esc(clamp(p.title || 'без названия', 60));
    const icon = row.is_ad ? '📣' : TYPE_ICONS[row.type] || '📄';
    const parts = [`${n}. ${icon} ${row.url ? `<a href="${row.url}">${title}</a>` : title}`];
    if (p.phone) parts.push(tg.esc(p.phone));
    if (row.published_at) parts.push(ageLabel(row.published_at, now));
    if (from === 'all' && row.source !== 'channel') parts.push('✍️ ваше');
    if (!row.live) parts.push('⌛ уже не на сайте');
    lines.push(parts.join(' · '));
    del.push({ text: `🗑 ${n}`, callback_data: `ldel:${row.id}` });
    // Чёрный список — против спама из групп; своё так не отсеивают.
    if (p.phone && row.source === 'channel') junk.push({ text: `🚫 ${n}`, callback_data: `lspm:${row.id}` });
  });
  lines.push(
    '',
    `🗑 — снять отовсюду.${junk.length ? ` 🚫 — снять и ${blockDays} дней не брать из групп посты с этим номером.` : ''}`
  );
  const nav = [];
  if (page > 1) nav.push({ text: '⏮ Свежие', callback_data: `lp:${from}:0` });
  if (page > 0) nav.push({ text: '⬅️ Новее', callback_data: `lp:${from}:${page - 1}` });
  if (page < pages - 1) nav.push({ text: 'Старее ➡️', callback_data: `lp:${from}:${page + 1}` });
  return {
    text: lines.join('\n'),
    extra: keyboard([...rowsOf(del), ...rowsOf(junk), ...(nav.length ? [nav] : []), tabs, [BACK]]),
  };
}

// Снятие оплаченной рекламы — с вопросом: в меню кнопка стоит рядом с
// «Обновить», и промах стоил бы рекламодателю его публикации.
function confirmRemoveView(ad, page = 0) {
  const title = (ad.parsed && ad.parsed.title) || 'реклама';
  return {
    text: [
      `🗑 Снять рекламу «${tg.esc(clamp(title, 80))}»?`,
      '',
      'Уберу с сайта, из канала, из Threads и из групп Telegram. Ролик в Instagram',
      'через API не удалить — дам на него ссылку.',
    ].join('\n'),
    extra: keyboard([
      [
        { text: '🗑 Да, снять', callback_data: `del:${ad.id}` },
        { text: '↩️ Нет', callback_data: `ai:${ad.id}:${page}` },
      ],
    ]),
  };
}

// «👥 Группы»: куда уходит реклама, от какого аккаунта, что выключено и почему.
function groupsView(o, now = Date.now()) {
  const lines = ['👥 <b>Реклама в группах Telegram</b>'];
  if (!o.groups.length) {
    lines.push('', 'Групп нет: бот берёт их из SOURCE_CHANNEL (или AD_GROUPS), а там пусто.');
    return { text: lines.join('\n'), extra: keyboard([[BACK]]) };
  }
  if (!o.connected) {
    lines.push(
      '',
      '⚠️ Аккаунт Telegram не подключён — писать в группы нечем. Нужна та же юзер-сессия,',
      'что читает группы (TELEGRAM_SESSION_STRING).'
    );
  }
  lines.push(`Рассылка: ${o.enabled ? '✅ включена' : '⏸ выключена'}`);
  if (o.account) {
    const who = `${tg.esc(o.account.name || 'без имени')}${o.account.username ? ` (@${tg.esc(o.account.username)})` : ''}`;
    lines.push(`Пишу от: ${who} — ${o.separate ? 'отдельный аккаунт для рекламы' : 'тот же аккаунт, что читает группы'}`);
  }
  if (o.restrictedUntil) lines.push(`⚠️ Telegram ограничил аккаунт за рассылку — пауза до ${clock(o.restrictedUntil)}`);
  lines.push(`По одной группе, пауза ≈${o.gapSec} с; в одну группу — не чаще раза в ${o.cooldownMin} мин.`, '');

  const buttons = [];
  o.groups.forEach((g, i) => {
    let state;
    if (g.off) state = 'выключена';
    else if (g.broken) state = `${tg.esc(g.broken.reason)}. Попробую снова ${whenText(g.broken.at + o.brokenHours * HOUR_MS)}`;
    else if (g.pending) state = `ждут очереди: ${g.pending}`;
    else if (g.lastSent) state = `последняя реклама ${agoText(now - new Date(g.lastSent).getTime())}`;
    else state = 'рекламы ещё не было';
    if (!g.off && !g.broken && g.week) state += ` · за неделю ${g.week}`;
    const icon = g.off ? '⏸' : g.broken ? '⚠️' : '✅';
    lines.push(`${i + 1}. ${icon} ${tg.esc(clamp(g.title, 40))} — ${state}`);
    buttons.push({ text: `${g.off || g.broken ? '▶️' : '⏸'} ${i + 1}`, callback_data: `gt:${i}` });
  });
  lines.push(
    '',
    '⏸/▶️ с номером — выключить или включить группу. Вакансии из выключенной',
    'я беру как раньше — не идёт в неё только реклама.'
  );

  const rows = [[o.enabled ? { text: '⏸ Выключить рассылку', callback_data: 'ge:0' } : { text: '▶️ Включить рассылку', callback_data: 'ge:1' }]];
  for (let i = 0; i < buttons.length; i += 5) rows.push(buttons.slice(i, i + 5));
  rows.push([{ text: '🔄 Обновить', callback_data: 'm:groups' }, BACK]);
  return { text: lines.join('\n'), extra: keyboard(rows) };
}

function adHowView({ warnHours = 6, goal = 1000 } = {}) {
  return withBack({
    text: [
      '➕ <b>Как выложить рекламу</b>',
      '',
      'Отправьте /ad и следом саму рекламу — текстом, картинкой или видео. Можно и',
      'сразу: «/ad Открылся салон…» или подписью к файлу.',
      '',
      'Что будет:',
      '• разберу, что это — вакансия, заказ или записка на доску — и выложу на сайт',
      '  вне очереди;',
      '• в Telegram-канал, Threads и Instagram — тоже первой;',
      '• в группы Telegram, из которых беру вакансии, — по одной, с паузами',
      '  (☰ Меню → 👥 Группы);',
      `• через ${warnHours} ч скажу, если в Threads не добирает до ${num(goal)}, через сутки пришлю отчёт.`,
      '',
      '/ad_fast — то же без разбора, когда лимит модели выбран.',
      'Реклама, оплаченная в директе Threads, выкладывается сама.',
      '',
      'Как она идёт — «📣 Реклама»: сначала новая, по нажатию — просмотры.',
    ].join('\n'),
  });
}

module.exports = {
  KEYS,
  KEYBOARD,
  COMMANDS,
  PAGE_SIZE,
  PUBLISHED_PAGE,
  PUBLISHED_TABS,
  BACK,
  homeView,
  withBack,
  adsListView,
  publishedView,
  adInfoView,
  confirmRemoveView,
  raiseSettingsView,
  raisesView,
  raisePlanText,
  raiseSummaryText,
  groupsView,
  adHowView,
};

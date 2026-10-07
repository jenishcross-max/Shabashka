const tg = require('./api');
const { num, viewsWord, clamp, clock, whenText, agoText } = require('./format');

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
  { command: 'last', description: 'Последние посты из групп' },
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
      [{ text: '🛍 Мои продукты', callback_data: 'm:products' }],
      [
        { text: '📥 Последние из групп', callback_data: 'm:last' },
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
    const reached = groups.filter((g) => g.status === 'sent' || g.status === 'deleted').length;
    lines.push('', `👥 <b>Группы Telegram</b> — ${reached} из ${groups.length}`);
    for (const g of groups) lines.push(groupLine(g, now));
    if (groups.some((g) => g.status === 'sent') && !groups.some((g) => typeof g.views === 'number')) {
      lines.push('Просмотры в группах Telegram не считает — только в каналах.');
    }
  } else {
    lines.push('', '👥 В группы Telegram не уходила.');
  }

  const top = [{ text: '🔄 Обновить', callback_data: `ai:${ad.id}:${page}:f` }];
  if (boostable && campaign) top.push({ text: '🔁 Поднять в Threads', callback_data: `ib:${campaign.id}:${ad.id}:${page}` });
  const mid = [];
  if (campaign) mid.push({ text: '📄 Отчёт для рекламодателя', callback_data: `ar:${campaign.id}` });
  if (ad.status === 'published') mid.push({ text: '🗑 Снять', callback_data: `ax:${ad.id}:${page}` });
  return {
    text: lines.join('\n'),
    extra: keyboard([top, ...(mid.length ? [mid] : []), [{ text: '⬅️ К списку', callback_data: `al:${page}` }, BACK]]),
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
  BACK,
  homeView,
  withBack,
  adsListView,
  adInfoView,
  confirmRemoveView,
  groupsView,
  adHowView,
};

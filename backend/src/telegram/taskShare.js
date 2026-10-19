// Задачи биржи — в Threads, Telegram-канал и подписчикам бота.
//
// На 19 октября 2026 у биржи ноль задач: заказчику незачем идти туда, где нет
// исполнителей, а исполнителю — туда, где нет задач. Разорвать этот круг может
// то, что у Шабашки уже есть, — охват. Заказчик размещает задачу, и её видят
// подписчики Threads и Telegram-канала, а исполнители, подписанные на биржу,
// получают её в боте сразу (см. subscriptions.notifyTask). Номера в посте нет —
// его и в задаче нет: чтобы предложить цену, исполнитель идёт на сайт.
//
// Раздаёт админ одной кнопкой, а не бот сам: задачу может разместить кто угодно
// после регистрации, и без проверки «работа на дому, пишите в WhatsApp» ушла
// бы в Threads от имени Шабашки. Заодно админ видит каждую задачу — пока их
// единицы, за первыми стоит проследить самому, чтобы на них откликнулись.
const db = require('../db');
const { weight, THREADS_LIMIT } = require('../social/video');
const { money } = require('../money');
const { esc } = require('./api');

const where = (task) => (task.work_format === 'online' ? 'Удалённо' : task.city);
const pay = (task) => (task.budget ? `${money(task.budget)} сом` : 'цену предложите вы');
const link = (task, { siteUrl }) => `${siteUrl}/tasks/${task.id}`;

// Обрезает описание по словам под остаток места: CTA и ссылка важнее хвоста
// описания, а обрубок посреди слова выглядит как сбой.
function fit(text, room) {
  let body = String(text || '').trim();
  if (weight(body) <= room) return body;
  while (body && weight(`${body}…`) > room) body = body.slice(0, -1).replace(/\s+\S*$/, '');
  return body ? `${body}…` : '';
}

// Пост в Threads: не длиннее 500 знаков (эмодзи — за четыре, см. video.weight).
function threadsText(task, deps) {
  const head = [`⚡ Задача на бирже: ${task.title}`, `📍 ${where(task)} · 💰 ${pay(task)}`];
  if (task.when_text) head.push(`🗓 ${task.when_text}`);
  const tail = ['Исполнители — предложите цену и срок на сайте, заказчик выберет одного 👇', deps.pretty(link(task, deps))];
  const fixed = weight([...head, '', '', ...tail].join('\n'));
  const body = fit(task.description, THREADS_LIMIT - fixed - 1);
  return [...head, ...(body ? ['', body] : []), '', ...tail].join('\n');
}

// Пост в Telegram-канал — HTML, ссылка настоящим тегом.
function channelText(task, deps) {
  const url = link(task, deps);
  return [
    `⚡ <b>Задача на бирже: ${esc(task.title)}</b>`,
    `📍 ${esc(where(task))} · 💰 ${esc(pay(task))}`,
    ...(task.when_text ? [`🗓 ${esc(task.when_text)}`] : []),
    '',
    esc(fit(task.description, 600)),
    '',
    `Исполнители — предложите цену и срок: <a href="${esc(url)}">${esc(deps.pretty(url))}</a>`,
  ].join('\n');
}

// Карточка админу: что за задача и раздавать ли её.
function cardText(task, deps, subscribers) {
  return [
    `⚡ <b>Новая задача на бирже</b> · #${task.id}`,
    '',
    `<b>${esc(task.title)}</b>`,
    `${esc(task.category)} · ${esc(where(task))} · 💰 ${esc(pay(task))}`,
    ...(task.when_text ? [`🗓 ${esc(task.when_text)}`] : []),
    '',
    esc(fit(task.description, 800)),
    '',
    `Заказчик: ${esc(task.owner_name || '—')}`,
    esc(deps.pretty(link(task, deps))),
    '',
    `Раздать в Threads, Telegram-канал и подписчикам на задачи (${subscribers})?`,
  ].join('\n');
}

const keyboard = (id) => ({
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📣 Раздать', callback_data: `tk:share:${id}` },
        { text: '🙈 Не раздавать', callback_data: `tk:skip:${id}` },
      ],
    ],
  },
});

// Новая задача → карточка каждому админу. Сбой у одного не мешает остальным.
async function announce(task, deps) {
  const subscribers = await deps.subscribers.count();
  const text = cardText(task, deps, subscribers);
  for (const adminId of deps.adminIds) {
    await deps.send(adminId, text, keyboard(task.id)).catch((err) => {
      console.error(`[биржа] карточка задачи ${task.id} → ${adminId}:`, err.message);
    });
  }
}

// Помечаем «раздано» до самой раздачи и одним запросом: два админа или двойной
// тап не выложат задачу дважды. Отменённую или уже занятую не раздаём.
async function claim(id) {
  const { rows } = await db.query(
    `UPDATE tasks SET shared_at = NOW() WHERE id = $1 AND shared_at IS NULL AND status = 'open' RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

// Раздача. Threads ждёт своей очереди (между постами — минуты), поэтому его
// итог приходит отдельным сообщением и только если не вышло.
async function share(task, deps) {
  let channel = null;
  if (deps.channel) {
    channel = await deps
      .channel(channelText(task, deps))
      .then(() => '✅')
      .catch((err) => `⚠️ ${err.message}`);
  }
  const subscribers = await deps.subscribers
    .notify(task)
    .then((r) => r.sent)
    .catch((err) => {
      console.error(`[биржа] подписчикам задачу ${task.id} не разослал:`, err.message);
      return 0;
    });
  let threads = null;
  if (deps.threads) {
    threads = 'в очереди';
    deps
      .threads(threadsText(task, deps))
      .then((result) => (result && !result.posted ? deps.report(`⚠️ Задача #${task.id} в Threads не ушла: ${result.reason}`) : null))
      .catch((err) => console.error(`[биржа] Threads, задача ${task.id}:`, err.message));
  }
  return { threads, channel, subscribers };
}

function resultText({ threads, channel, subscribers }) {
  return [
    '📣 Раздал:',
    `Threads — ${threads || 'не настроен'}`,
    `Telegram-канал — ${channel || 'не задан'}`,
    `Подписчикам на задачи — ${subscribers}`,
  ].join('\n');
}

// Кнопки под карточкой. true — наша.
async function onCallback(query, deps) {
  const [scope, action, rawId] = String(query.data || '').split(':');
  if (scope !== 'tk') return false;
  const id = Number(rawId);
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const base = query.message.text ? esc(query.message.text) : '';

  if (action === 'skip') {
    await deps.answer(query.id, 'Не раздаю — задача остаётся на сайте');
    await deps.edit(chatId, messageId, `${base}\n\n🙈 Не раздавали — задача только на сайте.`);
    return true;
  }
  if (action !== 'share') return false;

  if (!(await claim(id))) {
    await deps.answer(query.id, 'Уже раздана, отменена или исполнитель выбран');
    await deps.edit(chatId, messageId, `${base}\n\nℹ️ Раздавать не стал: задачу уже раздали, отменили или выбрали исполнителя.`);
    return true;
  }
  await deps.answer(query.id, 'Раздаю');
  const task = await deps.load(id);
  const result = await share(task, deps);
  await deps.edit(chatId, messageId, `${base}\n\n${resultText(result)}`);
  return true;
}

module.exports = { announce, onCallback, share, threadsText, channelText, cardText };

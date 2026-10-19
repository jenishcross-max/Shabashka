// «Кому написать» — авторы объявлений из групп, которым стоит сказать, что их
// объявление теперь и на Шабашке.
//
// Бот каждый день берёт из групп десятки подработок и вакансий, а их авторы о
// сайте не знают. Короткое личное сообщение «ваше объявление опубликовано,
// вот ссылка» приводит на сайт самого автора, а с ним — повод разместить
// следующую задачу на бирже уже самому. Так маркетплейсы и набирают первых
// заказчиков: руками, по одному, пока не заработало само.
//
// Пишет админ сам, со своего телефона, — бот только готовит список и текст:
// кнопка открывает WhatsApp с уже набранным сообщением. Рассылать это
// автоматически нельзя: WhatsApp и Telegram блокируют номера, которые пишут
// незнакомым пачками, а аккаунт, которым бот читает группы, нам нужен живым.
// Отсюда и потолок — DAILY в день, — и один раз на номер (outreach_contacts).
const db = require('../db');
const { esc } = require('./api');

const BATCH = 5;
const DAILY = 10;
const DAYS = 3;

const PATHS = { order: 'orders', vacancy: 'vacancies' };

// Свежие объявления из групп с номером, которым ещё не предлагали написать.
// Один номер — одна строка: автор с пятью объявлениями получит одно сообщение.
// Подработки первыми — их авторы и есть будущие заказчики биржи.
async function pick(limit) {
  const { rows } = await db.query(
    `WITH fresh AS (
       SELECT 'order' AS type, id, title, city, whatsapp_phone AS phone, created_at FROM orders
        WHERE is_imported AND status = 'open' AND whatsapp_phone <> ''
          AND created_at > NOW() - make_interval(days => $2)
       UNION ALL
       SELECT 'vacancy', id, title, city, whatsapp_phone, created_at FROM vacancies
        WHERE is_imported AND status = 'open' AND whatsapp_phone <> ''
          AND created_at > NOW() - make_interval(days => $2)
     ),
     one AS (
       SELECT DISTINCT ON (phone) * FROM fresh
        WHERE NOT EXISTS (SELECT 1 FROM outreach_contacts c WHERE c.phone = fresh.phone)
          AND NOT EXISTS (SELECT 1 FROM blocked_phones b WHERE b.phone = fresh.phone AND b.expires_at > NOW())
        ORDER BY phone, (type = 'order') DESC, created_at DESC
     )
     SELECT * FROM one ORDER BY (type = 'order') DESC, created_at DESC LIMIT $1`,
    [limit, DAYS]
  );
  return rows;
}

async function remember(items) {
  for (const item of items) {
    await db.query(
      'INSERT INTO outreach_contacts (phone, listing_type, listing_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [item.phone, item.type, item.id]
    );
  }
}

async function offeredToday() {
  // Сутки по Бишкеку (UTC+6), а не по серверу: «сегодня» для админа — его день.
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM outreach_contacts
      WHERE (created_at AT TIME ZONE 'Asia/Bishkek')::date = (NOW() AT TIME ZONE 'Asia/Bishkek')::date`
  );
  return rows[0].n;
}

// Текст, который откроется в WhatsApp. Коротко: длинное сообщение от
// незнакомца читают как рекламу, а ссылка в кнопке Telegram не бесконечна.
function messageFor(item, { siteUrl, pretty }) {
  const url = pretty(`${siteUrl}/${PATHS[item.type]}/${item.id}`);
  if (item.type === 'vacancy') {
    return [
      `Саламатсызбы! Ваша вакансия «${item.title}» бесплатно опубликована на сайте Шабашка: ${url}`,
      `Следующие вакансии можно размещать самим — бесплатно и без посредников: ${pretty(`${siteUrl}/vacancies/new`)}`,
      'Если вакансия уже закрыта — ответьте, и мы её снимем.',
    ].join('\n');
  }
  return [
    `Саламатсызбы! Ваше объявление «${item.title}» бесплатно опубликовано на сайте Шабашка: ${url}`,
    `Нужны мастера? Разместите задачу на бирже — исполнители сами предложат цену и срок: ${pretty(`${siteUrl}/tasks/new`)}`,
    'Если объявление уже не нужно — ответьте, и мы его снимем.',
  ].join('\n');
}

const waLink = (item, deps) =>
  `https://wa.me/${String(item.phone).replace(/\D/g, '')}?text=${encodeURIComponent(messageFor(item, deps))}`;

const KIND = { order: 'подработка', vacancy: 'вакансия' };

// Список — несколькими сообщениями: по одному на автора, каждое со своей
// кнопкой. Текст для WhatsApp едет в адресе кнопки, а кириллица в адресе
// занимает вшестеро больше места — пять таких кнопок в одном сообщении уже
// рискуют не пройти. Возвращает [{ text, extra }] — что отправить по порядку.
async function batch(deps) {
  const today = await offeredToday();
  if (today >= DAILY) {
    return [
      {
        text: `📨 На сегодня уже ${today} — новых пришлю завтра.\nWhatsApp блокирует номера, которые пачками пишут незнакомым, поэтому не больше ${DAILY} в день.`,
      },
    ];
  }
  const items = await pick(Math.min(BATCH, DAILY - today));
  if (!items.length) {
    return [{ text: `📨 Новых авторов с номером за ${DAYS} дня нет — всем уже предлагал написать.` }];
  }
  await remember(items);

  const head = {
    text: [
      `📨 <b>Кому написать</b> — ${items.length} из объявлений из групп`,
      '',
      'Кнопка открывает WhatsApp с готовым текстом: «ваше объявление на Шабашке, вот ссылка» и приглашение на биржу. Отправляете вы сами — проверьте текст перед отправкой.',
      `Не больше ${DAILY} в день: WhatsApp блокирует номера, которые пачками пишут незнакомым. Попросят снять — снимите из /last.`,
    ].join('\n'),
  };
  const cards = items.map((item, i) => {
    const rows = [[{ text: '💬 Написать в WhatsApp', url: waLink(item, deps) }]];
    if (i === items.length - 1) rows.push([{ text: '➡️ Ещё', callback_data: 'or:more' }]);
    return {
      text: [
        `${i + 1}. <b>${esc(item.title)}</b>`,
        `${KIND[item.type]} · ${esc(item.city)} · ${esc(item.phone)}`,
        esc(deps.pretty(`${deps.siteUrl}/${PATHS[item.type]}/${item.id}`)),
      ].join('\n'),
      extra: { reply_markup: { inline_keyboard: rows }, disable_web_page_preview: true },
    };
  });
  return [head, ...cards];
}

async function send(chatId, deps) {
  for (const { text, extra } of await batch(deps)) await deps.send(chatId, text, extra);
}

// Кнопка «Ещё». true — наша.
async function onCallback(query, deps) {
  if (query.data !== 'or:more') return false;
  await deps.answer(query.id, '');
  await send(query.message.chat.id, deps);
  return true;
}

module.exports = { batch, send, onCallback, messageFor, waLink, BATCH, DAILY };

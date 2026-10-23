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
// кнопки открывают Telegram или WhatsApp с уже набранным сообщением. Telegram
// первым: в нём админу привычнее, и WhatsApp не засоряется. Рассылать это
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
// Подработки первыми — их авторы и есть будущие заказчики биржи. Ник автора и
// ссылка на пост — из imported_listings (см. sourceWatcher.js), если есть.
async function pick(limit) {
  const { rows } = await db.query(
    `WITH fresh AS (
       SELECT 'order' AS type, o.id, o.title, o.description, o.city, o.whatsapp_phone AS phone, o.created_at,
              src.author_username AS username, src.source_link
         FROM orders o
         LEFT JOIN LATERAL (SELECT author_username, source_link FROM imported_listings
                             WHERE order_id = o.id ORDER BY id DESC LIMIT 1) src ON true
        WHERE o.is_imported AND o.status = 'open' AND o.whatsapp_phone <> ''
          AND o.created_at > NOW() - make_interval(days => $2)
       UNION ALL
       SELECT 'vacancy', v.id, v.title, v.description, v.city, v.whatsapp_phone, v.created_at,
              src.author_username, src.source_link
         FROM vacancies v
         LEFT JOIN LATERAL (SELECT author_username, source_link FROM imported_listings
                             WHERE vacancy_id = v.id ORDER BY id DESC LIMIT 1) src ON true
        WHERE v.is_imported AND v.status = 'open' AND v.whatsapp_phone <> ''
          AND v.created_at > NOW() - make_interval(days => $2)
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

// На каком языке объявление. Буквы ң, ө, ү есть только в кыргызском; без них
// (их часто не набирают) — по словам, которых в русском нет: двух хватает.
const KY_LETTERS = /[ңөүҢӨҮ]/;
const KY_WORDS =
  /(?<![\p{L}])(керек|жумуш\p{L}*|иште\p{L}*|айлык\p{L}*|кызмат\p{L}*|чакыр\p{L}*|тажрыйба\p{L}*|байланыш\p{L}*|жигит\p{L}*|бар|жок|саат|менен|үчүн|учун)(?![\p{L}])/giu;

function langOf(item) {
  const text = `${item.title || ''} ${item.description || ''}`;
  if (KY_LETTERS.test(text)) return 'ky';
  return (text.match(KY_WORDS) || []).length >= 2 ? 'ky' : 'ru';
}

// Текст, который откроется в Telegram или WhatsApp. На языке объявления:
// автору, который пишет по-кыргызски, русский текст от незнакомца читается как
// рассылка. Коротко и простыми словами — три строки: что сделали, что можно
// дальше, как отказаться. Длинное сообщение от незнакомца читают как рекламу,
// а ссылка в кнопке Telegram не бесконечна.
const TEXTS = {
  ru: {
    order: (title, url, next) => [
      `Саламатсызбы! Ваше объявление «${title}» есть на нашем сайте Шабашка: ${url}`,
      `Следующее можете разместить сами, бесплатно — мастера сами напишут и предложат цену, а вы выберете: ${next}`,
      'Если уже не нужно — ответьте, уберём.',
    ],
    vacancy: (title, url, next) => [
      `Саламатсызбы! Ваша вакансия «${title}» есть на нашем сайте Шабашка: ${url}`,
      `Следующие можете размещать сами, бесплатно — кандидаты будут звонить вам напрямую: ${next}`,
      'Если вакансия уже закрыта — ответьте, уберём.',
    ],
  },
  ky: {
    order: (title, url, next) => [
      `Саламатсызбы! Сиздин «${title}» жарыяңыз Шабашка сайтында жарыяланды: ${url}`,
      `Кийинкисин өзүңүз акысыз жайгаштыра аласыз — усталар өздөрү жазып, баасын айтышат, сиз тандайсыз: ${next}`,
      'Эгер жарыя керек болбой калса — жазыңыз, алып салабыз.',
    ],
    vacancy: (title, url, next) => [
      `Саламатсызбы! Сиздин «${title}» вакансияңыз Шабашка сайтында жарыяланды: ${url}`,
      `Кийинкилерин өзүңүз акысыз жайгаштыра аласыз — талапкерлер сизге түз чалышат: ${next}`,
      'Эгер вакансия жабылса — жазыңыз, алып салабыз.',
    ],
  },
};
const NEXT = { order: 'tasks/new', vacancy: 'vacancies/new' };

function messageFor(item, { siteUrl, pretty }) {
  const url = pretty(`${siteUrl}/${PATHS[item.type]}/${item.id}`);
  const next = pretty(`${siteUrl}/${NEXT[item.type]}`);
  return TEXTS[langOf(item)][item.type](item.title, url, next).join('\n');
}

const digits = (phone) => String(phone).replace(/\D/g, '');

const waLink = (item, deps) => `https://wa.me/${digits(item.phone)}?text=${encodeURIComponent(messageFor(item, deps))}`;

// Telegram открывает чат с набранным текстом и по нику, и по номеру
// (t.me/<ник>?text=, t.me/+<номер>?text=). Ник надёжнее: по номеру найдётся
// только тот, кто не закрыл поиск по номеру в настройках.
const tgLink = (item, deps) => {
  const text = encodeURIComponent(messageFor(item, deps));
  return item.username ? `https://t.me/${item.username}?text=${text}` : `https://t.me/+${digits(item.phone)}?text=${text}`;
};

const KIND = { order: 'подработка', vacancy: 'вакансия' };

// Список — несколькими сообщениями: по одному на автора, каждое со своей
// кнопкой. Текст для WhatsApp едет в адресе кнопки, а кириллица в адресе
// занимает вшестеро больше места — пять таких кнопок в одном сообщении уже
// рискуют не пройти. Возвращает [{ text, extra }] — что отправить по порядку.
//
// quiet — список едет следом за сводкой (см. summary.js), а не по кнопке:
// «на сегодня хватит» и «новых нет» там лишние, такая сводка просто без него.
async function batch(deps, { quiet = false } = {}) {
  const today = await offeredToday();
  if (today >= DAILY) {
    if (quiet) return [];
    return [
      {
        text: `📨 На сегодня уже ${today} — новых пришлю завтра.\nWhatsApp блокирует номера, которые пачками пишут незнакомым, поэтому не больше ${DAILY} в день.`,
      },
    ];
  }
  const items = await pick(Math.min(BATCH, DAILY - today));
  if (!items.length) {
    if (quiet) return [];
    return [{ text: `📨 Новых авторов с номером за ${DAYS} дня нет — всем уже предлагал написать.` }];
  }
  await remember(items);

  const head = {
    text: [
      `📨 <b>Кому написать</b> — ${items.length}`,
      '',
      'Нажмите Telegram или WhatsApp — откроется чат с готовым текстом на языке объявления. Проверьте и отправьте сами.',
      `Не больше ${DAILY} в день, чтобы номер не заблокировали. Попросят убрать — снимите в /last.`,
    ].join('\n'),
  };
  const cards = items.map((item, i) => {
    const rows = [
      [
        { text: item.username ? `✈️ Telegram @${item.username}` : '✈️ Telegram по номеру', url: tgLink(item, deps) },
        { text: '💬 WhatsApp', url: waLink(item, deps) },
      ],
    ];
    if (item.source_link) rows.push([{ text: '📄 Пост в группе', url: item.source_link }]);
    if (i === items.length - 1) rows.push([{ text: '➡️ Ещё', callback_data: 'or:more' }]);
    return {
      text: [
        `${i + 1}. <b>${esc(item.title)}</b>`,
        `${KIND[item.type]} · ${esc(item.city)} · ${esc(item.phone)}${item.username ? ` · @${esc(item.username)}` : ''}`,
        ...(langOf(item) === 'ky' ? ['текст — на кыргызском'] : []),
        esc(deps.pretty(`${deps.siteUrl}/${PATHS[item.type]}/${item.id}`)),
      ].join('\n'),
      extra: { reply_markup: { inline_keyboard: rows }, disable_web_page_preview: true },
    };
  });
  return [head, ...cards];
}

async function send(chatId, deps, opts) {
  for (const { text, extra } of await batch(deps, opts)) await deps.send(chatId, text, extra);
}

// Кнопка «Ещё». true — наша.
async function onCallback(query, deps) {
  if (query.data !== 'or:more') return false;
  await deps.answer(query.id, '');
  await send(query.message.chat.id, deps);
  return true;
}

module.exports = { batch, send, onCallback, messageFor, langOf, waLink, tgLink, BATCH, DAILY };

const db = require('../db');

// Отложенный разбор — то, что не влезло в лимиты модели и ждёт своего часа
// (см. park в bot.js).
//
// Раньше это жило только в памяти процесса, и рассуждение было такое: «доразбор
// через сутки после падения всё равно никому не нужен». Для постов из чужих
// групп это верно, а для платной рекламы — нет: за неё заплатили, и пропасть
// молча она не имеет права. А пропадала она именно так. Бесплатный Render
// перезапускает сервис сам — по нехватке памяти, при выкате, после сна, — и
// вместе с процессом исчезали и таймер, и сам текст объявления. В чате при этом
// оставалось бодрое «⏳ вернусь к нему сам через ≈ 7 мин», за которым не
// приходило уже ничего.
//
// Поэтому отложенное лежит в базе: строка на объявление, которую бот удаляет,
// когда до него дошли руки. После запуска он читает их обратно и доводит дело
// до конца (см. restoreDeferred в bot.js).
//
// Хранится тут исходный текст, а не разбор: разбора-то как раз и нет — до
// модели дело не дошло. Этого хватает, чтобы начать заново с того же места.

// Дольше этого срока отложенное не воскрешаем. Объявление суточной давности уже
// не объявление: по вакансии взяли человека, заказ сделали, а реклама, которую
// выложат назавтра, хуже, чем не выложенная вовсе. Тот же порядок, что и у
// SOURCE_MAX_AGE_HOURS в sourceWatcher.js.
const MAX_AGE_HOURS = 12;

// Сколько строк забираем за раз. Столько отложенных разом не наберётся никогда,
// но запрос без потолка — это запрос, который однажды вернёт всю таблицу.
const MAX_RESTORE = 50;

async function add({ chatId, messageId, text, ad, attempt, retryAt }) {
  const { rows } = await db.query(
    `INSERT INTO deferred_parses (chat_id, message_id, text, is_ad, attempt, retry_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [chatId, messageId || null, text, Boolean(ad), attempt, new Date(retryAt)]
  );
  return rows[0].id;
}

async function remove(id) {
  if (!id) return;
  await db.query('DELETE FROM deferred_parses WHERE id = $1', [id]);
}

// Что вернуть к жизни после перезапуска. Протухшее удаляем тут же: отдельной
// уборки для одной таблицы на пару строк заводить незачем.
async function restorable() {
  await db.query(`DELETE FROM deferred_parses WHERE created_at < NOW() - INTERVAL '${MAX_AGE_HOURS} hours'`);
  const { rows } = await db.query(
    `SELECT id, chat_id, message_id, text, is_ad, attempt, retry_at
       FROM deferred_parses
      ORDER BY is_ad DESC, retry_at ASC
      LIMIT ${MAX_RESTORE}`
  );
  // chat_id и message_id — BIGINT, и pg отдаёт их строками: точности JS на
  // такие числа не хватает вообще-то, но id чата и сообщения в Telegram далеко
  // до этой границы, а Bot API ждёт именно числа.
  return rows.map((row) => ({
    id: row.id,
    chatId: row.chat_id,
    messageId: row.message_id === null ? null : Number(row.message_id),
    text: row.text,
    ad: row.is_ad,
    attempt: row.attempt,
    retryAt: new Date(row.retry_at).getTime(),
  }));
}

module.exports = { add, remove, restorable, MAX_AGE_HOURS };

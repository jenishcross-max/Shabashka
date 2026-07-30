const db = require('./db');

// Журнал модерации: что сняли, когда и почему.
//
// Удалять объявление и не оставлять следа нельзя. Когда по объявлению придёт
// разбор — «у меня забрали деньги по вашему заказу» — единственное, чем площадка
// отвечает, это запись «объявление было вот такое, жалоба пришла тогда-то, сняли
// через столько-то». Само объявление к этому моменту уже удалено, и восстановить
// его нечем: доска чистит себя каждые шесть часов, а заказ удаляет автор.
// Поэтому строку перед удалением копируем сюда целиком, в JSON.
const SOURCES = {
  order: { table: 'orders', label: 'Заказ' },
  vacancy: { table: 'vacancies', label: 'Вакансия' },
  board: { table: 'board_posts', label: 'Доска' },
};

const LISTING_TYPES = Object.keys(SOURCES);

function tableFor(listingType) {
  const source = SOURCES[listingType];
  if (!source) throw new Error(`Неизвестный тип объявления: ${listingType}`);
  return source.table;
}

// id приходит из адреса запроса, где может оказаться что угодно. Приводим здесь,
// а не в каждом роуте: Postgres на строку вместо числа отвечает ошибкой запроса,
// а по смыслу это обычное «объявление не найдено».
function toId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Полная копия строки объявления. SELECT * намеренно: снимок должен пережить
// любые будущие колонки, а разбирать его будет человек, а не запрос.
async function snapshot(listingType, listingId) {
  const table = tableFor(listingType);
  const id = toId(listingId);
  if (id === null) return null;
  const { rows } = await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  return rows[0] || null;
}

// Короткая строка про объявление — для сообщения в Telegram и списка в админке.
// У записки на доске заголовка нет, там весь смысл в тексте.
function describe(listingType, snap) {
  if (!snap) return 'объявление уже удалено';
  const text = listingType === 'board' ? snap.text : snap.title;
  const one = String(text || 'без названия').replace(/\s+/g, ' ');
  return one.length > 120 ? `${one.slice(0, 120)}…` : one;
}

// action: removed | hidden | closed | dismissed. actor: admin:<id> | bot | author.
// snapshot можно передать готовым — если объявление уже прочитано или уже удалено
// и читать его больше негде.
async function log({ listingType, listingId, action, actor, reason = null, snapshot: given }) {
  const data = given === undefined ? await snapshot(listingType, listingId) : given;
  await db.query(
    `INSERT INTO moderation_log (listing_type, listing_id, action, actor, reason, snapshot)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [listingType, listingId, action, actor, reason, data || {}]
  );
}

// Снять объявление, оставив запись. Возвращает false, если его уже нет: удалять
// дважды нечего, а лишняя строка в журнале только мешала бы читать историю.
async function removeWithLog({ listingType, listingId, actor, reason = null }) {
  const snap = await snapshot(listingType, listingId);
  if (!snap) return false;
  await db.query(`DELETE FROM ${tableFor(listingType)} WHERE id = $1`, [snap.id]);
  await log({ listingType, listingId: snap.id, action: 'removed', actor, reason, snapshot: snap });
  return true;
}

function labelFor(listingType) {
  return SOURCES[listingType] ? SOURCES[listingType].label : listingType;
}

module.exports = { snapshot, describe, log, removeWithLog, labelFor, LISTING_TYPES };

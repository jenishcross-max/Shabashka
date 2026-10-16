const db = require('./db');

// Раздел «Объявления»: все запросы к ads. Правила «можно или нельзя» — в
// adsRules.js. Условия на статус и автора стоят в самих UPDATE и DELETE, а не
// только в роуте: между проверкой и записью модератор мог успеть снять
// объявление, и правка не должна вернуть его в ленту.

const AD_FIELDS = `
  ads.id, ads.user_id, ads.kind, ads.category, ads.title, ads.description, ads.price,
  ads.price_unit, ads.city, ads.address, ads.whatsapp_phone, ads.photos, ads.status, ads.views,
  ads.bumped_at, ads.created_at, ads.updated_at, users.name AS owner_name
`;

const EDITABLE = ['kind', 'category', 'title', 'description', 'price', 'price_unit', 'city', 'address', 'whatsapp_phone', 'photos'];

// «Дешевле» и «дороже» сравнивают суммы как есть: сутки в пансионате и месяц в
// квартире так не сравнить, но вид и рубрика в фильтре почти всегда уже выбраны.
// Договорные — в конце: без суммы им нет места в ряду цен.
const SORTS = {
  new: 'COALESCE(ads.bumped_at, ads.created_at) DESC, ads.id DESC',
  cheap: 'ads.price IS NULL, ads.price ASC, ads.id DESC',
  expensive: 'ads.price IS NULL, ads.price DESC, ads.id DESC',
};

const SELECT = `SELECT ${AD_FIELDS} FROM ads JOIN users ON users.id = ads.user_id`;
const one = ({ rows }) => rows[0] || null;

async function list({ kind, category, city, q, priceMin, priceMax, sort, page = 1, limit = 12 } = {}) {
  const clauses = ["ads.status = 'open'"];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (kind) clauses.push(`ads.kind = ${add(kind)}`);
  if (category) clauses.push(`ads.category = ${add(category)}`);
  if (city) clauses.push(`ads.city ILIKE ${add(`%${city}%`)}`);
  if (q) {
    const p = add(`%${q}%`);
    clauses.push(`(ads.title ILIKE ${p} OR ads.description ILIKE ${p})`);
  }
  if (Number.isFinite(priceMin)) clauses.push(`ads.price >= ${add(priceMin)}`);
  if (Number.isFinite(priceMax)) clauses.push(`ads.price <= ${add(priceMax)}`);
  const where = `WHERE ${clauses.join(' AND ')}`;

  const total = (await db.query(`SELECT COUNT(*)::int AS n FROM ads ${where}`, params)).rows[0].n;
  const { rows } = await db.query(
    `${SELECT} ${where} ORDER BY ${SORTS[sort] || SORTS.new}
     LIMIT ${add(limit)} OFFSET ${add((page - 1) * limit)}`,
    params
  );
  return { ads: rows, total };
}

async function get(id) {
  return one(await db.query(`${SELECT} WHERE ads.id = $1`, [id]));
}

async function addView(id) {
  await db.query('UPDATE ads SET views = views + 1 WHERE id = $1', [id]);
}

async function create(userId, f) {
  const { rows } = await db.query(
    `INSERT INTO ads (user_id, kind, category, title, description, price, price_unit, city, address, whatsapp_phone, photos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) RETURNING id`,
    [
      userId,
      f.kind,
      f.category,
      f.title,
      f.description,
      f.price,
      f.price_unit,
      f.city,
      f.address,
      f.whatsapp_phone,
      JSON.stringify(f.photos || []),
    ]
  );
  return rows[0].id;
}

// false — объявления уже нет или его снял модератор.
async function update(id, fields) {
  const keys = EDITABLE.filter((k) => fields[k] !== undefined);
  if (!keys.length) return false;
  const values = keys.map((k) => (k === 'photos' ? JSON.stringify(fields[k]) : fields[k]));
  const sets = keys.map((k, i) => `${k} = $${i + 2}${k === 'photos' ? '::jsonb' : ''}`);
  const { rows } = await db.query(
    `UPDATE ads SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $1 AND status IN ('open', 'closed') RETURNING id`,
    [id, ...values]
  );
  return rows.length > 0;
}

// Закрыть или открыть снова: только своё и только из from. false — статус
// успел смениться (вторая вкладка или модератор), роут ответит 409.
async function setStatus(id, ownerId, from, to) {
  const { rows } = await db.query(
    `UPDATE ads SET status = $4, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = $3 RETURNING id`,
    [id, ownerId, from, to]
  );
  return rows.length > 0;
}

async function bump(id) {
  await db.query("UPDATE ads SET bumped_at = NOW() WHERE id = $1 AND status = 'open'", [id]);
}

// Удалить своё объявление. Возвращает пути его фото — их роут уберёт из
// хранилища; null — удалять нечего или объявление чужое.
async function remove(id, ownerId) {
  const row = one(await db.query('DELETE FROM ads WHERE id = $1 AND user_id = $2 RETURNING photos', [id, ownerId]));
  return row ? row.photos : null;
}

// Мои — все, включая закрытые и снятые: автор должен видеть, что случилось с
// его объявлением, а не гадать, куда оно пропало.
async function mine(userId) {
  const { rows } = await db.query(`${SELECT} WHERE ads.user_id = $1 ORDER BY ads.created_at DESC`, [userId]);
  return rows;
}

// Пакетом по id — для избранного. Снятые модератором не отдаём: в избранном их
// показывать нечем, а ссылка на них всё равно ведёт в 404.
async function batch(ids) {
  if (!ids.length) return [];
  const { rows } = await db.query(`${SELECT} WHERE ads.id = ANY($1::int[]) AND ads.status <> 'removed'`, [ids]);
  return rows;
}

// Снять по жалобе. Не удаляем: на объявление есть жалоба, и оно само себе
// доказательство (как заказы, см. routes/admin.js).
async function removeByModerator(id) {
  const { rows } = await db.query(
    `UPDATE ads SET status = 'removed', updated_at = NOW()
     WHERE id = $1 AND status IN ('open', 'closed') RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

module.exports = { list, get, addView, create, update, setStatus, bump, remove, mine, batch, removeByModerator };

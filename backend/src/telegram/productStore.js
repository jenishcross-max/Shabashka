// Свои продукты админа в базе (см. telegram/products.js и таблицы products,
// product_posts в schema.sql).
const db = require('../db');

// Telegram присылает альбом пачкой сообщений почти одновременно, и
// «прочитать — дописать — записать» теряло бы фото. Поэтому дописываем одним
// UPDATE, и предел проверяет сама база.
const MAX_TEXTS = 20;
// Больше десяти фото Instagram в карусель не берёт.
const MAX_PHOTOS = 10;

const one = ({ rows }) => rows[0] || null;

const list = () => db.query('SELECT * FROM products ORDER BY created_at').then(({ rows }) => rows);

const get = (id) => db.query('SELECT * FROM products WHERE id = $1', [id]).then(one);

const create = (name) => db.query('INSERT INTO products (name) VALUES ($1) RETURNING *', [name]).then(one);

// null — предел уже выбран.
const addText = (id, text) =>
  db
    .query(
      `UPDATE products SET texts = texts || jsonb_build_array($2::text)
       WHERE id = $1 AND jsonb_array_length(texts) < $3 RETURNING *`,
      [id, text, MAX_TEXTS]
    )
    .then(one);

// photo — { file_id, kind }: kind «photo» — сжатое фото, «document» — фото,
// присланное файлом. Скачиваются они одинаково, а показать их альбомом в чате
// можно только порознь: Telegram не мешает в одном альбоме фото и файлы.
const addPhoto = (id, photo) =>
  db
    .query(
      `UPDATE products SET photos = photos || jsonb_build_array(jsonb_build_object('file_id', $2::text, 'kind', $3::text))
       WHERE id = $1 AND jsonb_array_length(photos) < $4 RETURNING *`,
      [id, photo.file_id, photo.kind, MAX_PHOTOS]
    )
    .then(one);

// jsonb - число убирает элемент массива по номеру.
const removeText = (id, index) =>
  db.query('UPDATE products SET texts = texts - $2::int WHERE id = $1 RETURNING *', [id, index]).then(one);

const removePhoto = (id, index) =>
  db.query('UPDATE products SET photos = photos - $2::int WHERE id = $1 RETURNING *', [id, index]).then(one);

const setEvery = (id, days) =>
  db.query('UPDATE products SET every_days = $2 WHERE id = $1 RETURNING *', [id, days || null]).then(one);

const setPaused = (id, paused) =>
  db.query('UPDATE products SET paused = $2 WHERE id = $1 RETURNING *', [id, paused]).then(one);

const remove = (id) => db.query('DELETE FROM products WHERE id = $1', [id]);

// Чей черёд выйти по расписанию: дольше всех ждущий — первым.
const due = () =>
  db
    .query(
      `SELECT * FROM products
       WHERE NOT paused AND every_days IS NOT NULL AND jsonb_array_length(texts) > 0
         AND (posted_at IS NULL OR posted_at <= NOW() - make_interval(days => every_days))
       ORDER BY posted_at NULLS FIRST LIMIT 1`
    )
    .then(one);

// Занять выход: кнопка и расписание могли сработать одновременно, и продукт
// вышел бы дважды подряд. Проходит только тот, кто застал turn прежним.
const claim = (id, turn) =>
  db
    .query('UPDATE products SET turn = turn + 1, posted_at = NOW() WHERE id = $1 AND turn = $2 RETURNING *', [id, turn])
    .then(one);

// Не вышло нигде — тот же текст пойдёт и в следующий раз. Время выхода не
// возвращаем: иначе расписание пробовало бы снова каждые десять минут.
const unclaim = (id) => db.query('UPDATE products SET turn = GREATEST(turn - 1, 0) WHERE id = $1', [id]);

const logPost = ({ productId, platform, postId = null, link = null, textNo, note = null }) =>
  db.query(
    `INSERT INTO product_posts (product_id, platform, post_id, link, text_no, note)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [productId, platform, postId, link, textNo, note]
  );

const posts = (productId, limit = 6) =>
  db
    .query('SELECT * FROM product_posts WHERE product_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2', [
      productId,
      limit,
    ])
    .then(({ rows }) => rows);

module.exports = {
  list,
  get,
  create,
  addText,
  addPhoto,
  removeText,
  removePhoto,
  setEvery,
  setPaused,
  remove,
  due,
  claim,
  unclaim,
  logPost,
  posts,
  MAX_TEXTS,
  MAX_PHOTOS,
};

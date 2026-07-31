const db = require('./db');

// Выборка для ролика-дайджеста: «Топ-5 вакансий» — пять случайных объявлений с
// сайта за последние двое суток. Обычный выпуск собирается из того, что админ
// только что прислал в бота; здесь наоборот — берём уже опубликованное, чтобы
// напомнить о сайте в те дни, когда новых скриншотов мало.
//
// Двое суток, а не сутки: за один день заказов одной категории набирается
// негусто, а объявление недельной давности в ленте уже раздражает — по нему
// звонят, а работа занята.
const DAYS = 2;
const SIZE = 5;

// Формы слова для «Топ-5 заказов» и строки на концовке. Русский тут не
// обходится одним окончанием, а Intl.PluralRules сказал бы «few/many», не
// подставив само слово.
const WORDS = {
  order: ['заказ', 'заказа', 'заказов'],
  vacancy: ['вакансия', 'вакансии', 'вакансий'],
  board: ['объявление', 'объявления', 'объявлений'],
};

// Просто множественное число, без счёта: «все вакансии на сайте».
const ALL = { order: 'заказы', vacancy: 'вакансии', board: 'объявления' };

function plural(n, forms) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  const mod10 = n % 10;
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

const word = (listingType, n) => plural(n, WORDS[listingType] || WORDS.order);

// У записки на доске нет ни заголовка, ни описания — она одна сплошная строка.
// Первую фразу берём заголовком, остальное описанием: на кадре заголовок
// набран крупным, и без разделения вся записка ушла бы в один огромный блок.
function fromBoardText(text) {
  const parts = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const head = parts[0] || 'Объявление';
  return {
    title: head.length > 70 ? `${head.slice(0, 70).replace(/\s+\S*$/, '')}…` : head,
    description: parts.slice(1).join(' ') || null,
  };
}

// SQL под каждый тип. ORDER BY random() честно перемешивает всю выборку — на
// сотнях строк за двое суток это доли миллисекунды, а держать своё окно
// смещений ради этого незачем.
const PICKS = {
  order: `SELECT id, title, description, category, city, budget, whatsapp_phone AS phone
            FROM orders
           WHERE status = 'open' AND created_at > NOW() - INTERVAL '${DAYS} days'`,
  vacancy: `SELECT id, title, description, category, city, salary_min AS budget, whatsapp_phone AS phone
              FROM vacancies
             WHERE status = 'open' AND created_at > NOW() - INTERVAL '${DAYS} days'`,
  // Записка на доске живёт шесть часов, так что окно в двое суток её не
  // ограничивает — ограничивает expires_at. Оставляем условие всё равно: оно
  // описывает выпуск («за два дня»), а не срок хранения.
  board: `SELECT id, text, city, whatsapp_phone AS phone
            FROM board_posts
           WHERE hidden = false AND expires_at > NOW()
             AND created_at > NOW() - INTERVAL '${DAYS} days'`,
};

function toParsed(listingType, row) {
  if (listingType === 'board') {
    return { ...fromBoardText(row.text), city: row.city, phone: row.phone, budget: null };
  }
  return {
    title: row.title,
    description: row.description,
    category: row.category,
    city: row.city,
    budget: row.budget,
    phone: row.phone,
  };
}

// Возвращает { items, total }: items — до пяти случайных объявлений в том виде,
// в каком их ждёт ролик, total — сколько их всего за окно (по нему на концовке
// пишем «и ещё 37 вакансий на сайте», иначе звать на сайт нечем).
async function pick(listingType, limit = SIZE) {
  const base = PICKS[listingType];
  if (!base) throw new Error(`Неизвестный тип: ${listingType}`);

  // LIMIT подставляется в текст запроса, поэтому число здесь обязано быть
  // числом: вызывают эту функцию только из кода, но проверка стоит одной строки.
  const n = Number.isInteger(limit) && limit > 0 ? limit : SIZE;

  const [{ rows }, { rows: counted }] = await Promise.all([
    db.query(`${base} ORDER BY random() LIMIT ${n}`),
    db.query(`SELECT COUNT(*)::int AS n FROM (${base}) q`),
  ]);

  return {
    items: rows.map((row) => ({ id: row.id, listingType, parsed: toParsed(listingType, row) })),
    total: counted[0].n,
  };
}

// «Топ-5 заказов» — заголовок выпуска на кадре и в подписи.
const collectionTitle = (listingType, n) => `Топ-${n} ${word(listingType, n)}`;

// Строка на концовке. Если за окном осталось что-то кроме показанного —
// называем, сколько именно: «и ещё 37 заказов на сайте» работает лучше, чем
// просто «все заказы на сайте», потому что это проверяемое число.
function cta(listingType, shown, total) {
  const rest = Math.max(0, total - shown);
  if (rest > 0) return `и ещё ${rest} ${word(listingType, rest)} на сайте`;
  // Именительный падеж, а не тот, что после числа: «все заказов» — не по-русски,
  // а из форм для счёта его не собрать.
  return `все ${ALL[listingType] || ALL.order} — на сайте`;
}

// «за 2 дня» — вместо числа в шапке ролика: дайджест собран не за сегодня, и
// сегодняшняя дата на кадре обещала бы не то.
const windowLabel = () => `за ${DAYS} ${plural(DAYS, ['день', 'дня', 'дней'])}`;

module.exports = { pick, collectionTitle, cta, word, windowLabel, DAYS, SIZE };

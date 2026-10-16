// Подписи раздела «Объявления» в одном месте: лента, страница, форма и «Мои
// публикации» должны называть одно и то же одинаково. Коды приходят с сервера
// (см. backend/src/adsRules.js) и не меняются, подписи — только здесь.

export const KINDS = [
  ['rent_out', 'Сдам'],
  ['rent', 'Сниму'],
  ['sell', 'Продам'],
  ['buy', 'Куплю'],
  ['free', 'Отдам даром'],
];

export const CATEGORIES = [
  ['housing', 'Жильё'],
  ['rest', 'Отдых'],
  ['transport', 'Транспорт'],
  ['tech', 'Техника и электроника'],
  ['home', 'Дом и стройка'],
  ['things', 'Одежда и вещи'],
  ['animals', 'Животные'],
  ['other', 'Другое'],
];

// Подсказки к рубрикам — в форме, чтобы пансионат не уехал в «Жильё», а
// гостевой дом не потерялся в «Другом».
export const CATEGORY_HINTS = {
  housing: 'квартиры, комнаты, дома',
  rest: 'пансионаты, гостевые дома, юрты',
  transport: 'машины, мотоциклы, запчасти',
  tech: 'телефоны, компьютеры, бытовая техника',
  home: 'мебель, стройматериалы, инструменты',
  things: 'одежда, обувь, детские вещи',
  animals: 'питомцы и всё для них',
  other: 'всё, что не подошло выше',
};

export const PRICE_UNITS = [
  ['total', 'за всё'],
  ['day', 'за сутки'],
  ['month', 'за месяц'],
  ['hour', 'за час'],
];

export const STATUS_LABELS = {
  open: 'Активно',
  closed: 'Закрыто',
  removed: 'Снято модератором',
};

export const MAX_PHOTOS = 6;

const lookup = (pairs) => Object.fromEntries(pairs);
export const KIND_LABELS = lookup(KINDS);
export const CATEGORY_LABELS = lookup(CATEGORIES);
const UNIT_LABELS = lookup(PRICE_UNITS);

// «2 500 сом за сутки», «45 000 сом» (за всё подпись не нужна), «Договорная»,
// «Даром». Куплю и сниму — это бюджет, а не цена: «до 30 000 сом за месяц».
export function priceLabel(ad) {
  if (ad.kind === 'free') return 'Даром';
  if (ad.price === null || ad.price === undefined) return 'Договорная';
  const sum = `${Number(ad.price).toLocaleString('ru-RU')} сом`;
  const unit = ad.price_unit && ad.price_unit !== 'total' ? ` ${UNIT_LABELS[ad.price_unit]}` : '';
  const prefix = ad.kind === 'buy' || ad.kind === 'rent' ? 'до ' : '';
  return `${prefix}${sum}${unit}`;
}

export function waLink(phone, title) {
  const digits = phone.replace(/[^\d]/g, '');
  const text = encodeURIComponent(`Здравствуйте! Пишу по объявлению «${title}» на Шабашка.`);
  return `https://wa.me/${digits}?text=${text}`;
}

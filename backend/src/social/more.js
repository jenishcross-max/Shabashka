// Последняя строка поста-объявления в Threads: «👉 Все 63 вакансии за сутки —
// шабашка.com/vacancies». Пост с номером самодостаточен: человек звонит прямо из
// ленты, и из сотен просмотров на сайт переходили единицы (исследование
// 18 октября 2026, см. docs/research). Ссылка на одну карточку повода зайти не
// даёт, а на все вакансии за сутки — даёт.
//
// Рекламе строки нет: рекламодатель платит за свой пост (см. shareListing в
// index.js). Числа — сколько вышло за сутки, их раз в час считает бот
// (setCounts), так что базы этому модулю не нужно.
const { plural } = require('../telegram/format');

// Меньше десяти за сутки — не хвалимся: «все 3 вакансии» скорее отпугнёт.
const MIN_COUNT = 10;

const WORDS = {
  vacancy: ['вакансия', 'вакансии', 'вакансий'],
  order: ['подработка', 'подработки', 'подработок'],
};

let counts = {};

// { vacancy, order } — сколько вышло за сутки.
function setCounts(next) {
  counts = next || {};
}

// siteLink — ссылка на карточку («шабашка.com/vacancies/12»); список — она же
// без номера.
function line(listingType, siteLink) {
  const n = Number(counts[listingType]);
  const words = WORDS[listingType];
  const list = String(siteLink || '').replace(/\/\d+$/, '');
  if (!words || !(n >= MIN_COUNT) || !list || list === siteLink) return '';
  return `👉 Все ${n} ${plural(n, words)} за сутки — ${list}`;
}

module.exports = { setCounts, line, MIN_COUNT };

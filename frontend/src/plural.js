// Русские числительные склоняются по трём формам: 1 заказ, 2 заказа, 5 заказов.
// Без этого на сайте появляется «1 заказов».
export function plural(n, one, few, many) {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Частые случаи — чтобы не повторять формы по всему коду.
export const orderWord = (n) => plural(n, 'заказ', 'заказа', 'заказов');
export const vacancyWord = (n) => plural(n, 'вакансия', 'вакансии', 'вакансий');
export const viewWord = (n) => plural(n, 'просмотр', 'просмотра', 'просмотров');

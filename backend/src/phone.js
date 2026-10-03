// Кыргызские номера в тексте объявления. Пишут их как придётся: «0700 123 456»,
// «996700123456», «+996 (700) 12-34-56» — поэтому один мягкий шаблон на всё и
// одно приведение к +996XXXXXXXXX. Живёт отдельно, потому что нужен и разбору
// (extract.js), и чёрному списку номеров (telegram/blocklist.js): две копии
// разошлись бы на первой же правке.

// Девять цифр подряд с любыми разделителями внутри — это уже либо номер, либо
// то, что модель разберёт в номер.
const CHUNK = /\d[\d\s()+\-.]{6,}\d/g;

// Модель просят привести номер к +996XXXXXXXXX, но иногда она переписывает его
// как есть, а кнопка WhatsApp на сайте с таким номером не откроется — поэтому
// приводим сами.
function normalizePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('996')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.length === 9 ? `+996${digits}` : null;
}

const chunks = (text) => String(text ?? '').match(CHUNK) || [];

// Есть ли в тексте что-то похожее на телефон. Нужна не для разбора, а для
// отсева до него: объявление без номера бот всё равно не публикует. Порог
// мягкий: цена ошибки несимметрична — лишний разбор стоит минуты очереди,
// пропущенное объявление — самого объявления.
function hasPhone(text) {
  return chunks(text).some((chunk) => chunk.replace(/\D/g, '').length >= 9);
}

// Первый номер из текста — в том виде, в каком его ждёт сайт.
function phoneFrom(text) {
  for (const chunk of chunks(text)) {
    const phone = normalizePhone(chunk);
    if (phone) return phone;
  }
  return null;
}

// Все номера из текста, без повторов.
function phonesIn(text) {
  return [...new Set(chunks(text).map(normalizePhone).filter(Boolean))];
}

module.exports = { normalizePhone, hasPhone, phoneFrom, phonesIn };

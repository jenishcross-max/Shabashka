// Кыргызские номера в тексте объявления (в рекламе — ещё и +7, см.
// normalizePhone). Пишут их как придётся: «0700 123 456», «996700123456»,
// «+996 (700) 12-34-56» — поэтому один мягкий шаблон на всё и одно приведение
// к +996XXXXXXXXX. Живёт отдельно, потому что нужен и разбору
// (extract.js), и чёрному списку номеров (telegram/blocklist.js): две копии
// разошлись бы на первой же правке.

// Девять цифр подряд с любыми разделителями внутри — это уже либо номер, либо
// то, что модель разберёт в номер.
const CHUNK = /\d[\d\s()+\-.]{6,}\d/g;

// Модель просят привести номер к +996XXXXXXXXX, но иногда она переписывает его
// как есть, а кнопка WhatsApp на сайте с таким номером не откроется — поэтому
// приводим сами.
//
// foreign — ещё и +7, Казахстан и Россия: 7 и десять цифр, дома пишут через 8.
// Только для рекламы: её присылает админ, и номер кофейни с казахстанской
// симкой там свой. В объявлениях из чужих чатов чужой номер — примета вербовки
// на выезд, и такие без кыргызского номера по-прежнему не выходят.
function normalizePhone(value, { foreign = false } = {}) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const local = digits.startsWith('996') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits;
  if (local.length === 9) return `+996${local}`;
  if (foreign && digits.length === 11 && /^[78]/.test(digits)) return `+7${digits.slice(1)}`;
  return null;
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
function phoneFrom(text, opts) {
  for (const chunk of chunks(text)) {
    const phone = normalizePhone(chunk, opts);
    if (phone) return phone;
  }
  return null;
}

// Все номера из текста, без повторов.
function phonesIn(text, opts) {
  return [...new Set(chunks(text).map((chunk) => normalizePhone(chunk, opts)).filter(Boolean))];
}

module.exports = { normalizePhone, hasPhone, phoneFrom, phonesIn };

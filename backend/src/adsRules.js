const { normalizePhone } = require('./phone');

// Раздел «Объявления»: правила без базы (запросы — в adsRepo.js). Что примет
// форма и кому что можно — решается здесь, чтобы сайт и Android-приложение
// получали от роута одинаковый ответ, а тесты проверяли правила без Postgres.

// Коды, а не подписи: подписи живут на клиенте (frontend/src/ads.js), а коды
// попадают в адрес страницы с фильтрами и не должны меняться от правки текста.
const KINDS = ['rent_out', 'rent', 'sell', 'buy', 'free'];
const CATEGORIES = ['housing', 'rest', 'transport', 'tech', 'home', 'things', 'animals', 'other'];
const PRICE_UNITS = ['total', 'day', 'month', 'hour'];
const STATUSES = ['open', 'closed', 'removed'];

const MAX_PHOTOS = 6;
// Квартира или машина стоят миллионы сомов — предел только против опечаток в
// десяток нулей, которые сломали бы сортировку по цене.
const MAX_PRICE = 1000000000;
const LIMITS = { title: 100, description: 3000, city: 60, address: 200 };

const text = (value) => String(value ?? '').trim();

// Цену набирают как на ценнике — «2 500» и «2500» одно и то же.
function toPrice(value) {
  const n = Number(text(value).replace(/\s/g, ''));
  return Number.isInteger(n) && n >= 1 && n <= MAX_PRICE ? n : null;
}

// Свои фото — только из своей папки в хранилище: путь выдаёт бэкенд при
// загрузке (см. routes/ads.js), и чужой путь в форме значит, что картинку
// пытаются прицепить к своему объявлению без спроса.
function photoPattern(userId) {
  return new RegExp(`^u${Number(userId)}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$`);
}

// Полная проверка и для создания, и для правки: форма всегда шлёт все поля, а
// цена зависит от вида — частичная правка разошлась бы с ним.
function validateAd(body, { userId }) {
  const errors = [];
  const result = {};

  if (!KINDS.includes(body.kind)) errors.push('Выберите, что вы делаете: сдаёте, продаёте, ищете…');
  else result.kind = body.kind;

  if (!CATEGORIES.includes(body.category)) errors.push('Выберите рубрику из списка');
  else result.category = body.category;

  const title = text(body.title);
  if (!title) errors.push('Напишите заголовок объявления');
  else if (title.length > LIMITS.title) errors.push(`Заголовок слишком длинный (макс. ${LIMITS.title} символов)`);
  else result.title = title;

  const description = text(body.description);
  if (!description) errors.push('Опишите, что предлагаете или ищете');
  else if (description.length > LIMITS.description) {
    errors.push(`Описание слишком длинное (макс. ${LIMITS.description} символов)`);
  } else result.description = description;

  // «Отдам даром» без цены по смыслу; у остальных пустая цена — «договорная».
  if (body.kind === 'free' || !text(body.price)) {
    result.price = null;
    result.price_unit = null;
  } else {
    const price = toPrice(body.price);
    const unit = body.price_unit === undefined || body.price_unit === null || body.price_unit === '' ? 'total' : body.price_unit;
    if (price === null) errors.push('Укажите цену числом в сомах или оставьте поле пустым — будет «Договорная»');
    else if (!PRICE_UNITS.includes(unit)) errors.push('Укажите, за что цена: за всё, за сутки, за месяц или за час');
    else {
      result.price = price;
      result.price_unit = unit;
    }
  }

  const city = text(body.city);
  if (!city) errors.push('Укажите город');
  else if (city.length > LIMITS.city) errors.push('Слишком длинное название города');
  else result.city = city;

  const address = text(body.address);
  if (address.length > LIMITS.address) errors.push(`Адрес слишком длинный (макс. ${LIMITS.address} символов)`);
  else result.address = address || null;

  const rawPhone = text(body.whatsapp_phone);
  if (!rawPhone) result.whatsapp_phone = null; // номер необязателен — можно писать через сайт
  else {
    const phone = normalizePhone(rawPhone);
    if (!phone) errors.push('Укажите номер WhatsApp в формате 0700 123 456 или оставьте поле пустым');
    else result.whatsapp_phone = phone;
  }

  const photos = body.photos === undefined || body.photos === null ? [] : body.photos;
  const own = photoPattern(userId);
  if (!Array.isArray(photos) || photos.some((p) => typeof p !== 'string' || !own.test(p))) {
    errors.push('Не удалось прикрепить фото — загрузите их заново');
  } else if (new Set(photos).size !== photos.length) errors.push('Одно и то же фото добавлено дважды');
  else if (photos.length > MAX_PHOTOS) errors.push(`Можно прикрепить не больше ${MAX_PHOTOS} фото`);
  else result.photos = photos;

  return { errors, result };
}

// Действия автора: edit | close | reopen | bump | delete. null — можно, иначе
// готовый ответ. Снятое модератором можно только удалить: открыть его снова
// значило бы обойти модерацию одной кнопкой.
function ownerBlocker(ad, userId, action) {
  if (ad.user_id !== userId) return { status: 403, error: 'Это не ваше объявление' };
  if (action === 'delete') return null;
  if (ad.status === 'removed') {
    return { status: 409, error: 'Объявление снято модератором — его можно только удалить' };
  }
  if (action === 'close' && ad.status !== 'open') return { status: 409, error: 'Объявление уже закрыто' };
  if (action === 'reopen' && ad.status !== 'closed') return { status: 409, error: 'Объявление и так открыто' };
  if (action === 'bump' && ad.status !== 'open') {
    return { status: 409, error: 'Поднять можно только открытое объявление' };
  }
  return null;
}

module.exports = {
  KINDS,
  CATEGORIES,
  PRICE_UNITS,
  STATUSES,
  MAX_PHOTOS,
  MAX_PRICE,
  LIMITS,
  photoPattern,
  validateAd,
  ownerBlocker,
};

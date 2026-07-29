const categoriesRepo = require('../categoriesRepo');
const KNOWN_CITIES = require('../cities');

// Разбор объявления из скриншота или пересланного текста в поля заказа.
//
// Регулярками это не берётся: «нужен сантехник срочно ор чуй 8й мкр 2000с» —
// обычная форма записи в чатах, где нет ни знаков препинания, ни порядка полей,
// а половина сообщений вообще не объявления. Поэтому здесь vision-модель, а не
// парсер: она же отсеивает болтовню флагом is_listing.
//
// Gemini Flash — у неё есть постоянный бесплатный тариф (порядка 1500 запросов
// в сутки), чего для одного бота с ручной модерацией хватает с запасом. Ключ
// берётся на https://aistudio.google.com/apikey.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Схема в формате OpenAPI, а не JSON Schema: Gemini понимает только этот
// диалект — типы заглавными буквами, без additionalProperties.
//
// Все поля — строки, пустая строка означает «не указано». Числа и null
// потребовали бы отдельной обработки в схеме, а приводить типы всё равно нам.
function buildSchema(categories) {
  const str = { type: 'STRING' };
  return {
    type: 'OBJECT',
    properties: {
      is_listing: {
        type: 'BOOLEAN',
        description: 'true, если это объявление о работе или заказ услуги, а не обычное сообщение',
      },
      listing_type: { type: 'STRING', enum: ['order', 'vacancy', 'other'] },
      title: { ...str, description: 'Короткий заголовок, до 70 символов, без слова «требуется» в начале' },
      description: { ...str, description: 'Суть заказа своими словами, 1–3 предложения' },
      category: { type: 'STRING', enum: [...categories, ''] },
      city: str,
      address: { ...str, description: 'Район или микрорайон, без номера дома и квартиры' },
      budget: { ...str, description: 'Только число в сомах, без валюты. Пусто, если цена не указана' },
      phone: { ...str, description: 'Телефон в формате +996XXXXXXXXX. Пусто, если номера нет' },
      work_format: { type: 'STRING', enum: ['online', 'offline'] },
      note: { ...str, description: 'Одна фраза для администратора: что непонятно или требует проверки' },
    },
    required: [
      'is_listing',
      'listing_type',
      'title',
      'description',
      'category',
      'city',
      'address',
      'budget',
      'phone',
      'work_format',
      'note',
    ],
    // Порядок полей в ответе. Модель заполняет их подряд, поэтому заголовок и
    // описание идут раньше категории — так у неё уже есть, на что опереться.
    propertyOrdering: [
      'is_listing',
      'listing_type',
      'title',
      'description',
      'category',
      'city',
      'address',
      'budget',
      'phone',
      'work_format',
      'note',
    ],
  };
}

function buildSystem(categories) {
  return [
    'Ты разбираешь объявления из чатов Кыргызстана (WhatsApp, Telegram) в структуру для доски объявлений «Шабашка».',
    '',
    'Правила:',
    '- Текст может быть на русском, кыргызском или вперемешку, с опечатками и без знаков препинания. Заголовок и описание пиши по-русски, грамотно.',
    '- is_listing = false для переписки, приветствий, рекламы товаров, объявлений о продаже вещей, поиска жилья. Это не заказы услуг и не вакансии.',
    '- listing_type = "order", если человек ищет исполнителя; "vacancy", если работодатель зовёт на работу; иначе "other".',
    `- category выбирай строго из списка: ${categories.join(', ')}. Если ничего не подходит — «Другое».`,
    `- city: если город не назван, но упомянут район Бишкека (Аламедин, Восток-5, Джал, мкр, Тунгуч, Асанбай и т.п.) — ставь «Бишкек». Известные города: ${KNOWN_CITIES.join(', ')}.`,
    '- address: только район или микрорайон. Точный адрес, номер дома, подъезд и квартиру не переноси, даже если они есть в тексте.',
    '- budget: число в сомах. «2000с», «2 000 сом», «2к» → 2000. Если указана вилка — бери нижнюю границу. «Договорная» → пусто.',
    '- phone: приводи к формату +996XXXXXXXXX. «0700 123 456» → «+996700123456».',
    '- work_format = "online" только для работы, которую делают удалённо (дизайн, тексты, программирование). Всё физическое — "offline".',
    '- Ничего не выдумывай. Если поля нет в тексте — оставь пустую строку.',
  ].join('\n');
}

// Кыргызские номера пишут как придётся: «0700 123 456», «996700123456»,
// «+996 (700) 12-34-56». Модель просят привести их к +996XXXXXXXXX, но Flash
// иногда переписывает номер как есть, а кнопка WhatsApp на сайте с таким
// номером не откроется — поэтому приводим сами, не полагаясь на модель.
function normalizePhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('996')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.length === 9 ? `+996${digits}` : null;
}

function normalize(raw) {
  const clean = (v) => String(v ?? '').trim();
  const budgetDigits = clean(raw.budget).replace(/\D/g, '');

  return {
    is_listing: Boolean(raw.is_listing),
    listing_type: clean(raw.listing_type) || 'other',
    title: clean(raw.title).slice(0, 120),
    description: clean(raw.description),
    category: clean(raw.category),
    city: clean(raw.city),
    address: clean(raw.address).slice(0, 200) || null,
    budget: budgetDigits ? Number(budgetDigits) : null,
    phone: normalizePhone(raw.phone),
    work_format: raw.work_format === 'online' ? 'online' : 'offline',
    note: clean(raw.note),
  };
}

// Единственное место, где мы ходим в Gemini. parts — куски запроса: текст,
// картинка или и то и другое.
async function ask(parts, systemSuffix) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Не задан GEMINI_API_KEY');

  const categories = await categoriesRepo.listNames();
  const system = systemSuffix
    ? `${buildSystem(categories)}\n\n${systemSuffix}`
    : buildSystem(categories);

  const res = await fetch(`${API_BASE}/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
        responseSchema: buildSchema(categories),
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const detail = data && data.error ? data.error.message : res.status;
    throw new Error(`Gemini: ${detail}`);
  }

  // Фильтры безопасности срабатывают на чужой текст без предупреждения —
  // отвечаем понятной фразой, чтобы в чате не было голого стектрейса.
  const blocked = data.promptFeedback && data.promptFeedback.blockReason;
  if (blocked) throw new Error(`Модель отказалась разбирать это сообщение (${blocked})`);

  const candidate = data.candidates && data.candidates[0];
  const text =
    candidate &&
    candidate.content &&
    candidate.content.parts &&
    candidate.content.parts.map((p) => p.text || '').join('');
  if (!text) throw new Error('Пустой ответ модели');

  return normalize(JSON.parse(text));
}

// Скриншот из чата: на нём видно и текст объявления, и интерфейс мессенджера —
// модели это не мешает, а вот кропать заранее пришлось бы вручную.
function fromImage(buffer, mediaType = 'image/jpeg') {
  return ask([
    { inline_data: { mime_type: mediaType, data: buffer.toString('base64') } },
    { text: 'Разбери объявление с этого скриншота.' },
  ]);
}

function fromText(text) {
  return ask([{ text: `Разбери это сообщение из чата:\n\n${text}` }]);
}

// Правки от администратора применяются к уже разобранному JSON, а не к
// исходнику: так «город Ош» меняет только город и не сбрасывает остальные поля.
function applyCorrections(parsed, corrections) {
  return ask(
    [{ text: `Разобранное объявление:\n${JSON.stringify(parsed, null, 2)}\n\nПравки:\n${corrections}` }],
    'Сейчас тебе дают уже разобранное объявление и правки администратора. Верни тот же объект с внесёнными правками, остальные поля оставь как есть.'
  );
}

module.exports = { fromImage, fromText, applyCorrections };

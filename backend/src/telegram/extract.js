const categoriesRepo = require('../categoriesRepo');
const KNOWN_CITIES = require('../cities');

// Разбор объявления из скриншота или пересланного текста в поля заказа.
//
// Регулярками это не берётся: «нужен сантехник срочно ор чуй 8й мкр 2000с» —
// обычная форма записи в чатах, где нет ни знаков препинания, ни порядка полей,
// а половина сообщений вообще не объявления. Поэтому здесь vision-модель, а не
// парсер: она же отсеивает болтовню флагом is_listing.
//
// Groq (Llama 4 Scout) — бесплатный тариф без карты и без региональных
// ограничений (в отличие от Gemini, который в Кыргызстане выдаёт квоту 0).
// Ключ берётся на https://console.groq.com/keys.
const MODEL = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Обычный JSON Schema (в отличие от Gemini, у Groq тот же диалект, что и везде).
// strict-режим требует все поля в required и additionalProperties: false —
// «нет значения» кодируем пустой строкой, а не null.
function buildSchema(categories) {
  const str = { type: 'string' };
  return {
    type: 'object',
    properties: {
      is_listing: {
        type: 'boolean',
        description: 'true, если это объявление о работе или заказ услуги, а не обычное сообщение',
      },
      listing_type: { type: 'string', enum: ['order', 'vacancy', 'other'] },
      title: { ...str, description: 'Короткий заголовок, до 70 символов, без слова «требуется» в начале' },
      description: { ...str, description: 'Суть заказа своими словами, 1–3 предложения' },
      category: { type: 'string', enum: categories },
      city: str,
      address: { ...str, description: 'Район или микрорайон, без номера дома и квартиры' },
      budget: { ...str, description: 'Только число в сомах, без валюты. Пусто, если цена не указана' },
      phone: { ...str, description: 'Телефон в формате +996XXXXXXXXX. Пусто, если номера нет' },
      work_format: { type: 'string', enum: ['online', 'offline'] },
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
    additionalProperties: false,
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
// «+996 (700) 12-34-56». Модель просят привести их к +996XXXXXXXXX, но
// иногда она переписывает номер как есть, а кнопка WhatsApp на сайте с таким
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

// Единственное место, где мы ходим в Groq. content — тело user-сообщения в
// формате OpenAI chat completions: строка или массив частей text/image_url.
async function ask(content, systemSuffix) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('Не задан GROQ_API_KEY');

  const categories = await categoriesRepo.listNames();
  const system = systemSuffix
    ? `${buildSystem(categories)}\n\n${systemSuffix}`
    : buildSystem(categories);

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_completion_tokens: 2000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'listing', strict: true, schema: buildSchema(categories) },
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const detail = data && data.error ? data.error.message : res.status;
    throw new Error(`Groq: ${detail}`);
  }

  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('Пустой ответ модели');

  return normalize(JSON.parse(text));
}

// Скриншот из чата: на нём видно и текст объявления, и интерфейс мессенджера —
// модели это не мешает, а вот кропать заранее пришлось бы вручную.
function fromImage(buffer, mediaType = 'image/jpeg') {
  return ask([
    { type: 'text', text: 'Разбери объявление с этого скриншота.' },
    { type: 'image_url', image_url: { url: `data:${mediaType};base64,${buffer.toString('base64')}` } },
  ]);
}

function fromText(text) {
  return ask(`Разбери это сообщение из чата:\n\n${text}`);
}

// Правки от администратора применяются к уже разобранному JSON, а не к
// исходнику: так «город Ош» меняет только город и не сбрасывает остальные поля.
function applyCorrections(parsed, corrections) {
  return ask(
    `Разобранное объявление:\n${JSON.stringify(parsed, null, 2)}\n\nПравки:\n${corrections}`,
    'Сейчас тебе дают уже разобранное объявление и правки администратора. Верни тот же объект с внесёнными правками, остальные поля оставь как есть.'
  );
}

module.exports = { fromImage, fromText, applyCorrections };

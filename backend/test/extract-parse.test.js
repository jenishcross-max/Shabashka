// Разбор ответа модели: телефоны, нормализация полей и отсев заграницы, которую
// модель пропустила (см. normalize в src/telegram/extract.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');

process.env.GROQ_API_KEY = 'ключ-для-теста';
process.env.GROQ_DAILY_TOKENS = '10000000';
delete process.env.FALLBACK_API_URL;

const requireSrc = install({
  [at('categoriesRepo.js')]: { listNames: async () => ['Сантехника', 'Другое'] },
  [at('telegram/notify.js')]: { ADMIN_IDS: new Set(['1']), isAllowed: () => true, notifyAdmins: async () => {} },
});

let answer = {};
global.fetch = async () => ({
  ok: true,
  status: 200,
  // Заголовки с остатком минутного лимита: по ним бот держит темп, и без них
  // он ждёт между разборами фиксированные 35 секунд — тест бы на этом и завис
  // (см. waitMs в extract.js). Свободный лимит значит «паузы не нужно».
  headers: {
    get: (name) =>
      ({ 'x-ratelimit-remaining-tokens': '8000', 'x-ratelimit-reset-tokens': '1s' })[name] ?? null,
  },
  json: async () => ({
    choices: [{ message: { content: typeof answer === 'string' ? answer : JSON.stringify(answer) } }],
    usage: { total_tokens: 4000 },
  }),
});

const extract = requireSrc('telegram/extract.js');
const parse = async (listings) => {
  answer = { listings };
  return extract.fromText('текст объявления, которого хватает по длине 0700111222');
};

test('телефон в тексте узнаётся в любом виде записи', () => {
  for (const text of ['0700 123 456', '+996 (700) 12-34-56', 'звоните 996700123456', 'тел.0700-123-456']) {
    assert.equal(extract.hasPhone(text), true, text);
  }
  for (const text of ['цена 2000 сом', 'дом 12 кв 5', '', 'смена 12 часов']) {
    assert.equal(extract.hasPhone(text), false, text);
  }
});

test('первый номер из текста приводится к виду, который ждёт сайт', () => {
  assert.equal(extract.phoneFrom('Ватс ап 0500 16 06 33'), '+996500160633');
  assert.equal(extract.phoneFrom('996 700 123456 или 0555 111222'), '+996700123456');
  assert.equal(extract.phoneFrom('цена 2000 сом'), null);
});

test('поля приводятся к виду карточки, а мусорные значения заменяются своими', async () => {
  const [listing] = await parse([
    {
      is_listing: true,
      listing_type: 'странный-тип',
      title: 'Нужен сантехник',
      description: 'Поменять смеситель',
      category: 'Сантехника',
      city: 'Бишкек',
      budget: '2 000 сом',
      phone: '0700 12 34 56',
      work_format: 'чтотоещё',
      employment_type: 'выдумка',
      experience: 'выдумка',
    },
  ]);
  assert.equal(listing.listing_type, 'order', 'неизвестный тип — заказ, самый частый в этих чатах');
  assert.equal(listing.budget, 2000, 'из «2 000 сом» остаётся число');
  assert.equal(listing.phone, '+996700123456');
  assert.equal(listing.work_format, 'offline', 'онлайном считается только явное «online»');
  assert.equal(listing.employment_type, 'gig');
  assert.equal(listing.experience, 'no_experience');
});

test('работа за границей отсеивается, даже когда модель её пропустила', async () => {
  const [listing] = await parse([
    {
      is_listing: true,
      listing_type: 'vacancy',
      title: 'Требуются рабочие',
      description: 'Вахта 60/30, проживание',
      city: 'Москва',
      phone: '0700111222',
    },
  ]);
  assert.equal(listing.is_listing, false);
  assert.equal(listing.abroad, true, 'пометка нужна: за отказом по рекламе идёт публикация «как есть»');
  assert.match(listing.note, /работа за границей/);
});

test('товар из-за границы объявлением остаётся', async () => {
  const [listing] = await parse([
    {
      is_listing: true,
      listing_type: 'board',
      title: 'Продаю машину из Кореи',
      description: 'Растаможена, торг',
      city: 'Бишкек',
      phone: '0700111222',
    },
  ]);
  assert.equal(listing.is_listing, true);
  assert.equal(listing.abroad, false);
});

test('ответ без обёртки listings читается как одно объявление', async () => {
  answer = { is_listing: true, listing_type: 'order', title: 'Один', phone: '0700111222' };
  const list = await extract.fromText('текст объявления подлиннее пятнадцати знаков');
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'Один');
});

test('пояснение вокруг JSON и неэкранированные слэши не ломают разбор', async () => {
  answer =
    'Вот разбор:\n```json\n{"listings":[{"is_listing":true,"listing_type":"order","title":"График 5\\2","phone":"0700111222"}]}\n```\nГотово.';
  const [listing] = await extract.fromText('текст объявления подлиннее пятнадцати знаков');
  assert.equal(listing.title, 'График 5\\2');
});

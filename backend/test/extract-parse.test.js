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

// Реклама из чата 6 октября: три вакансии подряд, номер — один, в самом конце.
// Модель не приписала его ни одной, и все три ушли в «без номера — не
// публикую», а за ними и вся реклама.
const THREE_VACANCIES = String.raw`Требуются:

❗Администратор в дневную или ночную смену.
🌕Дневная смена: 08.00-19.30 , 2\2.
🌒Ночная смена: 20.00 - 08.00 или 17.30-07.00, 2\2.
💰Оплата: 2700-3200 с\смена.

💵 Кассир-менеджер доставки в дневную или ночную смену.
🕗Время работы: 08.00 - 20.00 или 20.00-08.00
➡Оплата: 1900-2000 с\смена.

✅Гостевой менеджер с опытом работы в ночных заведениях.
🕘Время работы: 18.00-06.00
💰Заработная плата: 2200 с\смена.
📍Локация: 6 мкр.

☎ Ватсап: 0500 16 06 33`;

test('номер один на всё сообщение — он у каждой вакансии из него', async () => {
  const vacancy = (title) => ({ is_listing: true, listing_type: 'vacancy', title, description: title, phone: '' });
  answer = { listings: [vacancy('Администратор'), vacancy('Кассир-менеджер доставки'), vacancy('Гостевой менеджер')] };
  const list = await extract.fromText(THREE_VACANCIES);
  assert.deepEqual(
    list.map((l) => l.phone),
    ['+996500160633', '+996500160633', '+996500160633'],
    'время смен и вилки зарплат за номер не приняты'
  );

  // Номеров два — какой чей, не угадать: не выдумываем.
  answer = { listings: [vacancy('Повар'), { ...vacancy('Официант'), phone: '0700111222' }] };
  const two = await extract.fromText('Повар — 0555 123 456. Официант — 0700 111 222. Оплата каждый день.');
  assert.equal(two[0].phone, null);
  assert.equal(two[1].phone, '+996700111222');
});

test('оборванный ответ модели не теряет готовые объявления', async () => {
  // Модель упёрлась в потолок ответа посреди второго объявления.
  answer =
    '{"listings":[{"is_listing":true,"listing_type":"board","title":"Сдаю квартиру, Моссовет","phone":"0700111222"},' +
    '{"is_listing":true,"listing_type":"board","title":"Сдаю комнату","description":"С мебелью, бытовая техн';
  const cut = await extract.fromText('текст объявления подлиннее пятнадцати знаков');
  assert.deepEqual(
    cut.map((l) => l.title),
    ['Сдаю квартиру, Моссовет'],
    'целое — берём, оборванное — нет'
  );

  // Забыла закрыть внешнюю скобку — всё объявление на месте.
  answer = '{"listings":[{"is_listing":true,"listing_type":"order","title":"Нужен сантехник","phone":"0700111222"}]';
  const [plumber] = await extract.fromText('текст объявления подлиннее пятнадцати знаков');
  assert.equal(plumber.title, 'Нужен сантехник');

  // Оборвалась на первом же — честная ошибка, как и раньше.
  answer = '{"listings":[{"is_listing":true,"title":"Сдаю кварт';
  await assert.rejects(extract.fromText('текст объявления подлиннее пятнадцати знаков'), /Модель вернула не JSON/);
});

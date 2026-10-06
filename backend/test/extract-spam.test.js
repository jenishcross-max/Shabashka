// Проверка по словам после модели (см. screen в src/telegram/extract.js).
// Запасные модели лесенки пропускают сетевой найм и «доверенность на машину»,
// хотя промпт про них говорит прямо, — поэтому то, что модель назвала
// объявлением, ещё раз смотрится словами. По каждому объявлению отдельно: в
// пачке один сетевой не должен утянуть за собой настоящие.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');

process.env.GROQ_API_KEY = 'ключ-для-теста';
process.env.GROQ_MODELS = 'openai/gpt-oss-20b';
delete process.env.FALLBACK_API_URL;

const requireSrc = install({
  [at('categoriesRepo.js')]: { listNames: async () => ['Другое'] },
  [at('telegram/notify.js')]: { ADMIN_IDS: new Set(['1']), isAllowed: () => true, notifyAdmins: async () => {} },
});

let reply = [];
global.fetch = async () => ({
  ok: true,
  status: 200,
  headers: { get: (name) => ({ 'x-ratelimit-remaining-tokens': '8000', 'x-ratelimit-reset-tokens': '1s' })[name] ?? null },
  json: async () => ({ choices: [{ message: { content: JSON.stringify({ listings: reply }) } }], usage: { total_tokens: 3000 } }),
});

const extract = requireSrc('telegram/extract.js');

const OFFICE = {
  is_listing: true,
  listing_type: 'vacancy',
  title: 'Помощник администратора в офис',
  description:
    'Ищем девушек и парней. Можно без опыта — всему научим! Работа в офисе в центре города, карьерный рост. Возраст от 16 до 40 лет.',
  phone: '0700123456',
};
const PLUMBER = { is_listing: true, listing_type: 'order', title: 'Нужен сантехник', description: 'Поменять смеситель', phone: '0700111222' };
const CAR = {
  is_listing: true,
  listing_type: 'board',
  title: 'Доверенность на машину',
  description: 'Нотариуска барып Китайдан келген машинага доверность жазыш керек. Загс барлар жарабайт. Акчасы дароо колго берилет.',
  phone: '0555987654',
};

test('сетевой найм, пропущенный моделью, отсеивается, а соседнее объявление остаётся', async () => {
  reply = [OFFICE, PLUMBER];
  const [office, plumber] = await extract.fromText('пачка из группы');
  assert.equal(office.is_listing, false);
  assert.equal(office.spam, 'mlm');
  assert.match(office.note, /помощник\S* администратора/i);
  assert.equal(office.forbidden, false, 'сетевое не запрещено для рекламы — решает админ');
  assert.equal(plumber.is_listing, true, 'настоящий заказ из той же пачки не пострадал');
});

test('в рекламе сетевое проходит, а доверенность на машину — нет, и выкладывать её «как есть» нельзя', async () => {
  reply = [OFFICE];
  const [office] = await extract.fromText('/ad', { ad: true });
  assert.equal(office.is_listing, true);

  reply = [CAR];
  const [car] = await extract.fromText('/ad', { ad: true });
  assert.equal(car.is_listing, false);
  assert.equal(car.forbidden, true);
});

test('пост, который админ вернул из /spam, второй раз как сетевой не отсеивается, а запрещённое — да', async () => {
  reply = [OFFICE];
  const [office] = await extract.fromText('из /spam', { trusted: true });
  assert.equal(office.is_listing, true);

  reply = [CAR];
  const [car] = await extract.fromText('из /spam', { trusted: true });
  assert.equal(car.is_listing, false);
  assert.equal(car.forbidden, true);
});

test('«можно студентам» в тексте — пометка для студентов; у доски её не бывает', async () => {
  reply = [
    { is_listing: true, listing_type: 'vacancy', title: 'Официант', description: 'Можно студентам, гибкий график', phone: '0700111333' },
    { is_listing: true, listing_type: 'board', title: 'Сдаю комнату', description: 'Студентам скидка', phone: '0700111444' },
    { is_listing: true, listing_type: 'order', title: 'Раздать листовки', description: 'Подойдёт студентам, 1000 сом', phone: '0700111555' },
  ];
  const [vacancy, board, order] = await extract.fromText('пачка');
  assert.equal(vacancy.for_students, true);
  assert.equal(board.for_students, false);
  assert.equal(order.for_students, true);
});

test('в сообщении «не студенты» — пометки нет, что бы модель ни пересказала', async () => {
  // Пересказ модели зовёт студентов, а сам работодатель — нет.
  reply = [{ is_listing: true, listing_type: 'vacancy', title: 'Бариста', description: 'Гибкий график, подойдёт студентам', phone: '0700111333' }];
  const [vacancy] = await extract.fromText('Требуется бариста в кофейню. Возраст от 20 лет, не студенты. График 8:30–21:00. 0700111333');
  assert.equal(vacancy.is_listing, true);
  assert.equal(vacancy.for_students, false);
});

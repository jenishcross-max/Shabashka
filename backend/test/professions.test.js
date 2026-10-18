// Категории по профессиям (исследование 18 октября 2026, см. docs/research):
// 87% вакансий из чатов лежали в «Другом» — официанта нельзя было найти
// фильтром, а под «работа официантом Бишкек» не было страницы. Заголовки ниже —
// настоящие, из той выборки (src/professions.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
// Список категорий в базе правит админ; здесь — тот, что задаёт тест.
let known = [];
const requireSrc = install({
  [at('db/index.js')]: db,
  [at('categoriesRepo.js')]: { listNames: async () => known },
});
const professions = requireSrc('professions.js');
const imports = requireSrc('telegram/imports.js');

const CASES = {
  Общепит: [
    'Шаурма жайына жумуш',
    'Кассага и повар керек Фас Фудка',
    'Требуется официантка и техничка в китайский ресторан',
    'Официантка жана посудомойщица кыздар керек',
    'ПЕКАРЬ',
    'Требуется сушеф в суши-бар',
    'Кафеге посудомойчица керек',
    'Идиш жуучу кызматкер (посудомойщица)',
    'Требуется официант, кассир, администратор, повар, курьер в «Масахиро»',
    'Кухработница в чайхану',
  ],
  Продажи: [
    'Сатуучу балдар кыздар керек!',
    'Торговый агент',
    'Кассир в магазин Спар',
    'Продавец-консультант с опытом',
    'Цветочный магазинге иштей турган кыздар керек',
    'Требуется Мерчендайзер',
    'Требуется менеджер по продажам в швейный цех',
  ],
  'Швейный цех': [
    'Швея',
    'Срочно закройщик (женский швейный цех)',
    'Тажырыйбалуу тигуучулор керек',
    'ТЕЗ АРАДА ТИГҮҮ ФАБРИКАСЫНА ТАЖРЫЙБАЛУУ ТИГҮҮЧҮЛӨР КЕРЕК!',
    'Требуется утюжник на постоянную работу',
    '4-нитка женских рубашек',
  ],
  'Автомойка, СТО и АЗС': [
    'Вулканизацияга жана мойкага балдар керек',
    'Ищут работников на автомойку',
    'Требуются автомойщики',
    'Кассир жана газ куюучу керек',
  ],
  'Водители и курьеры': [
    'Курьеры в службу доставки Баратам',
    'Требуется универсальный водитель',
    'Требуются Экспедиторы в компанию RoLa',
    'Курьер (мото, авто, вело, пеший)',
  ],
  'Склад и грузчики': [
    'Грузчик',
    'Грузчик в магазин Спар',
    'Жүк ташуучулар (грузчик)',
    'Требуется 5 человек на разгрузку/погрузку',
    'Упаковщица керек срочно',
  ],
  'Стройка и разнорабочие': [
    'Разнорабочий на завтра',
    'Кирпич койгонго подсобник бала керек',
    'Газоблок укладка',
    'Сварщик керек опытный',
    'Требуются каменщики',
    'Эки бала керек стройкага',
    'Требуется 1 р/рабочий',
    'Эртенкиге жумуш керек, разнарабочий',
    'Сетка урганга балдар керек',
    'Срочно нужны рабочие на объект в Бостери',
    'Балгарка кезгенди билген бала керек',
    'Подработка: монтаж оборудования',
  ],
  Охрана: ['Охранник в магазин Спар', 'ОХРАНАГА БАЛДАР керек'],
  Офис: ['Администратор в бильярдный клуб', 'Требуется оператор колл-центра'],
  Уборка: ['Техничка на ночь', 'Техничкалар керек'],
};

test('профессия узнаётся по заголовку — по-русски и по-кыргызски', () => {
  for (const [category, titles] of Object.entries(CASES)) {
    for (const title of titles) assert.equal(professions.guess(title), category, title);
  }
});

test('не узнали — null, а заголовок важнее описания', () => {
  for (const title of ['Вакансия жумы', 'Требуются парни и девушки', 'Бэк-вокалистка']) {
    assert.equal(professions.guess(title), null, title);
  }
  assert.equal(professions.guess('Требуются парни и девушки', 'Работа в кафе, официант'), 'Общепит', 'по описанию');
  assert.equal(professions.guess('Грузчик', 'Склад продуктового магазина, кафе рядом'), 'Склад и грузчики');
});

test('applyDefaults берёт профессию вместо «Другого», если она есть в списке', async () => {
  known = ['Уборка', 'Другое', ...professions.CATEGORIES];
  const base = { title: 'Официант керек', description: 'Кафеге', city: 'Бишкек' };
  assert.equal((await imports.applyDefaults({ ...base, category: 'Другое' })).parsed.category, 'Общепит');
  assert.equal((await imports.applyDefaults({ ...base, category: '' })).parsed.category, 'Общепит');
  assert.equal(
    (await imports.applyDefaults({ ...base, category: 'Уборка' })).parsed.category,
    'Уборка',
    'выбор модели из списка не трогаем'
  );
  assert.equal(
    (await imports.applyDefaults({ ...base, title: 'Требуются парни', description: 'Звоните', category: 'Другое' })).parsed
      .category,
    'Другое'
  );
});

test('открытые объявления из «Другого» раскладываются по профессиям, остальное не трогается', async () => {
  for (const table of ['orders', 'vacancies']) {
    await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT false`);
  }
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
     VALUES ('Бот', 'prof@test.kg', '+996700005001', 'x', true, 'customer') RETURNING id`
  );
  const userId = rows[0].id;
  const vacancy = async (title, category = 'Другое', status = 'open') =>
    (
      await db.query(
        `INSERT INTO vacancies (user_id, title, description, category, employment_type, city, work_format, experience, status)
         VALUES ($1, $2, 'Описание', $3, 'gig', 'Бишкек', 'offline', 'no_experience', $4) RETURNING id`,
        [userId, title, category, status]
      )
    ).rows[0].id;
  const order = async (title) =>
    (
      await db.query(
        `INSERT INTO orders (user_id, title, description, category, city, work_format)
         VALUES ($1, $2, 'Описание', 'Другое', 'Бишкек', 'offline') RETURNING id`,
        [userId, title]
      )
    ).rows[0].id;

  const waiter = await vacancy('Официант керек');
  const unknown = await vacancy('Требуются парни и девушки');
  const closed = await vacancy('Швея', 'Другое', 'closed');
  const chosen = await vacancy('Повар', 'Уборка');
  const labourer = await order('Разнорабочий на завтра');

  known = ['Другое', 'Уборка', ...professions.CATEGORIES];
  const moved = await professions.backfill();
  assert.deepEqual(moved, { vacancies: 1, orders: 1 });
  const categoryOf = async (table, id) => (await db.query(`SELECT category FROM ${table} WHERE id = $1`, [id])).rows[0].category;
  assert.equal(await categoryOf('vacancies', waiter), 'Общепит');
  assert.equal(await categoryOf('vacancies', unknown), 'Другое');
  assert.equal(await categoryOf('vacancies', closed), 'Другое', 'закрытые не трогаем');
  assert.equal(await categoryOf('vacancies', chosen), 'Уборка', 'чужой выбор не трогаем');
  assert.equal(await categoryOf('orders', labourer), 'Стройка и разнорабочие');

  await vacancy('Официант керек');
  known = ['Другое'];
  assert.deepEqual(await professions.backfill(), { vacancies: 0, orders: 0 }, 'категорий нет в списке — не переносим');
});

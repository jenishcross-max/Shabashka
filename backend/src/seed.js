// Заполняет базу реалистичными демо-данными для показа сайта.
// Использование: node src/seed.js
// ВНИМАНИЕ: полностью очищает users/orders/vacancies/reports перед заполнением.
const bcrypt = require('bcryptjs');
const db = require('./db');
const categoriesRepo = require('./categoriesRepo');

const CITIES = ['Бишкек', 'Ош', 'Кант', 'Токмок', 'Каракол', 'Джалал-Абад', 'Нарын', 'Талас', 'Баткен', 'Чолпон-Ата'];

const CUSTOMERS = [
  ['Азамат Токтогулов', 'azamat.t'],
  ['Гульнара Садыкова', 'gulnara.s'],
  ['Данияр Кубанов', 'daniyar.k'],
  ['Айгерим Бекова', 'aigerim.b'],
  ['Марат Жумабеков', 'marat.j'],
  ['Нурбек Осмонов', 'nurbek.o'],
  ['Чолпон Асанова', 'cholpon.a'],
  ['Эркин Мамбетов', 'erkin.m'],
  ['Жаныл Törökulova', 'janyl.t'],
  ['Бакыт Раимкулов', 'bakyt.r'],
  ['Салтанат Дүйшеева', 'saltanat.d'],
  ['Тилек Абдразаков', 'tilek.a'],
];

// [category, [ {title, description, budgetRange:[min,max]|null}, ... ]]
const TEMPLATES = {
  'Ремонт': [
    { title: 'Почистить дымоход в частном доме', description: 'Дом не чистили два сезона, нужен мастер со своим инструментом. Работа на 2–3 часа.', budget: [1500, 2500] },
    { title: 'Поклеить обои в зале', description: 'Комната 18 м², обои уже куплены, нужно только поклеить. Стены ровные.', budget: [3000, 5000] },
    { title: 'Заделать трещины на потолке', description: 'После землетрясения появились трещины, нужно зашпаклевать и покрасить.', budget: [2000, 4000] },
    { title: 'Установить натяжной потолок', description: 'Кухня 9 м², материал предоставит заказчик. Нужна бригада с оборудованием.', budget: [6000, 9000] },
    { title: 'Покрасить фасад дома', description: 'Одноэтажный дом, площадь фасада примерно 80 м². Краска будет куплена отдельно.', budget: [8000, 15000] },
  ],
  'Уборка': [
    { title: 'Убрать 2-комнатную после ремонта', description: 'Генеральная уборка, вынести строительный мусор, помыть окна. Свои средства.', budget: [1200, 2000] },
    { title: 'Еженедельная уборка квартиры', description: 'Ищем человека на постоянной основе, 1 раз в неделю, 2 часа.', budget: [800, 1200] },
    { title: 'Уборка после стройки в офисе', description: 'Офис 60 м², много пыли, нужна бригада 2–3 человека.', budget: [4000, 7000] },
    { title: 'Помыть окна в квартире', description: '3-комнатная квартира, окна с двух сторон. 4 этаж.', budget: [700, 1200] },
    { title: 'Химчистка ковров на дому', description: 'Два ковра 2х3 метра, нужно выбить и почистить.', budget: null },
  ],
  'Грузоперевозки': [
    { title: 'Перевезти диван и шкаф', description: 'Из Асанбая в 12 микрорайон. Нужны грузчики — 2 человека и газель.', budget: null },
    { title: 'Переезд квартиры целиком', description: '2-комнатная квартира, мебель и коробки. Нужна машина побольше и 3 грузчика.', budget: [5000, 8000] },
    { title: 'Доставить стройматериалы', description: 'Цемент и кирпич с рынка Дордой до объекта в Джале.', budget: [1500, 2500] },
    { title: 'Перевезти холодильник', description: 'Нужна машина и один грузчик, недалеко — соседний район.', budget: [800, 1500] },
    { title: 'Вывезти строительный мусор', description: 'После ремонта осталось много мусора, нужен самосвал.', budget: [2000, 3500] },
  ],
  'Репетиторы': [
    { title: 'Репетитор по математике, 9 класс', description: 'Подготовка к экзамену, 2 раза в неделю. Можно онлайн или район Джал.', budget: [400, 600] },
    { title: 'Английский язык для начинающих', description: 'Взрослый ученик, с нуля, разговорный английский, 2 занятия в неделю.', budget: [500, 800] },
    { title: 'Подготовка к ОРТ по физике', description: 'Ученик 11 класса, нужно подтянуть механику и электричество.', budget: [500, 700] },
    { title: 'Репетитор по кыргызскому языку', description: 'Ребёнок 3 класс, нужна помощь с домашними заданиями 2 раза в неделю.', budget: [300, 500] },
    { title: 'Программирование для школьника', description: 'Основы Python, мальчик 14 лет, интересуется программированием.', budget: [600, 900] },
  ],
  'Красота': [
    { title: 'Маникюр на дому', description: 'Гель-лак, район Восток-5. Желательно мастер с опытом и своими материалами.', budget: [600, 900] },
    { title: 'Стрижка и укладка на выезд', description: 'Нужен парикмахер на дом перед мероприятием, вечером в субботу.', budget: [800, 1200] },
    { title: 'Наращивание ресниц', description: 'Классика, объём 2D. Ищу мастера с портфолио.', budget: [1000, 1500] },
    { title: 'Макияж на свадьбу', description: 'Нужен визажист на утро, выезд в район ЦУМа.', budget: [2000, 3500] },
    { title: 'Мужская стрижка на дому', description: 'Стрижка машинкой и ножницами, для пожилого человека.', budget: [400, 600] },
  ],
  'Электрика': [
    { title: 'Установить люстру и розетки', description: 'Повесить люстру в зале и заменить 4 розетки. Материал куплен.', budget: [1000, 1500] },
    { title: 'Проводка в новой квартире', description: 'Полная разводка проводки в квартире 70 м² в новостройке.', budget: [12000, 20000] },
    { title: 'Заменить автоматы в щитке', description: 'Старые автоматы часто выбивает, нужна замена на новые.', budget: [1500, 2500] },
    { title: 'Подключить бойлер', description: 'Нужен отдельный автомат и подключение проточного водонагревателя.', budget: [800, 1500] },
    { title: 'Устранить короткое замыкание', description: 'Периодически выбивает свет во всей квартире, нужна диагностика.', budget: null },
  ],
  'Сантехника': [
    { title: 'Устранить течь под раковиной', description: 'Подтекает сифон на кухне, нужно заменить или подтянуть.', budget: [500, 900] },
    { title: 'Заменить смеситель в ванной', description: 'Старый смеситель сломан, новый уже куплен.', budget: [500, 800] },
    { title: 'Установить унитаз', description: 'Новый унитаз куплен, нужна установка и подключение.', budget: [800, 1200] },
    { title: 'Прочистить канализацию', description: 'Плохо уходит вода на кухне, возможен засор в стояке.', budget: [700, 1300] },
    { title: 'Разводка труб в санузле', description: 'Полная замена труб в совмещённом санузле, металл на полипропилен.', budget: [5000, 9000] },
  ],
  'Сад и огород': [
    { title: 'Подстричь газон и кусты', description: 'Участок 6 соток, нужна триммерная стрижка и уборка обрезков.', budget: [1200, 2000] },
    { title: 'Посадить деревья на участке', description: 'Нужно посадить 6 саженцев яблони, ямы можно копать самим.', budget: [1000, 1800] },
    { title: 'Вспахать огород под посадку', description: 'Участок 4 сотки, нужен мотоблок или трактор.', budget: [1500, 2500] },
    { title: 'Обрезать старые деревья', description: 'Два больших ореховых дерева требуют санитарной обрезки.', budget: [2000, 3500] },
    { title: 'Поливной полив теплицы', description: 'Настроить капельный полив в теплице 20 м².', budget: null },
  ],
  'Другое': [
    { title: 'Собрать шкаф-купе', description: 'Шкаф IKEA, инструкция есть, нужен человек с опытом сборки мебели.', budget: [800, 1400] },
    { title: 'Настроить компьютер и Wi-Fi', description: 'Медленно работает ноутбук, нужна чистка и настройка сети.', budget: [500, 900] },
    { title: 'Выгулять и покормить собаку', description: 'Уезжаем на неделю, нужен человек для присмотра за собакой два раза в день.', budget: [300, 500] },
    { title: 'Помочь с переездом коробок', description: 'Нужна пара рук перенести коробки с 3 этажа без лифта.', budget: [500, 900] },
    { title: 'Расклеить объявления по району', description: 'Нужно расклеить 100 листовок в Джале и Асанбае.', budget: [500, 800] },
  ],
  // Онлайн-категории — показывают формат работы "🌐 Онлайн" на карточках
  'Дизайн': [
    { title: 'Нарисовать логотип для кофейни', description: 'Нужен минималистичный логотип, 2–3 варианта на выбор, в векторе.', budget: [3000, 6000] },
  ],
  'Программирование и IT': [
    { title: 'Сделать лендинг на WordPress', description: 'Одностраничный сайт для услуг, есть готовый макет в Figma.', budget: [8000, 15000] },
  ],
  'Переводы': [
    { title: 'Перевести документы на английский', description: 'Пакет документов для визы, 10 страниц, нужен точный перевод.', budget: [2000, 4000] },
  ],
  'Копирайтинг и тексты': [
    { title: 'Написать тексты для сайта', description: '5 страниц: главная, о нас, услуги, контакты, блог.', budget: [3000, 5000] },
  ],
  'Онлайн-консультации': [
    { title: 'Юридическая консультация по трудовому спору', description: 'Нужна консультация по видеосвязи, вопрос по увольнению.', budget: [1000, 2000] },
  ],
  'Маркетинг и SMM': [
    { title: 'Вести Instagram магазина одежды', description: '2–3 поста в неделю, сторис, нужен опыт в нише одежды.', budget: [5000, 10000] },
  ],
  'Бухгалтерия онлайн': [
    { title: 'Вести бухгалтерию ИП удалённо', description: 'Упрощёнка, немного операций в месяц, сдача отчётности.', budget: [4000, 8000] },
  ],
  'Психология и коучинг': [
    { title: 'Консультация психолога онлайн', description: 'Разовая консультация по видеосвязи, вечернее время.', budget: [1000, 2000] },
  ],
};

// Категории, которые физически привязаны к месту — заказы/вакансии по ним всегда офлайн.
// Должно соответствовать offlineOnlyCategories в db/index.js.
const OFFLINE_ONLY_CATEGORIES = ['Ремонт', 'Уборка', 'Грузоперевозки', 'Красота', 'Электрика', 'Сантехника', 'Сад и огород'];
const ONLINE_CATEGORIES = require('./onlineCategories');

function pickWorkFormat(category) {
  if (OFFLINE_ONLY_CATEGORIES.includes(category)) return 'offline';
  if (ONLINE_CATEGORIES.includes(category)) return 'online';
  return Math.random() < 0.5 ? 'online' : 'offline'; // 'Репетиторы' и 'Другое' — оба формата
}

const EMPLOYMENT_VALUES = ['full_time', 'part_time', 'shift', 'gig', 'internship'];
const SCHEDULES = ['Пн–Пт, 9:00–18:00', 'Пн–Сб, 10:00–19:00', 'Сменный график 2/2', 'По договорённости'];

// Вакансии — постоянная/частичная работа, в отличие от разовых заказов
const VACANCY_TEMPLATES = {
  'Ремонт': [
    { title: 'Мастер по ремонту квартир', description: 'Ищем мастера с опытом штукатурных и малярных работ на постоянные объекты компании.', salary: [30000, 55000] },
    { title: 'Помощник мастера-ремонтника', description: 'Обучим на месте, нужен ответственный человек без вредных привычек.', salary: [20000, 30000] },
  ],
  'Уборка': [
    { title: 'Клинер в клининговую компанию', description: 'Уборка квартир и офисов по графику, объекты в пределах города.', salary: [25000, 40000] },
    { title: 'Уборщица в бизнес-центр', description: 'Ежедневная уборка офисных помещений, утренняя смена.', salary: [18000, 25000] },
  ],
  'Грузоперевозки': [
    { title: 'Водитель-экспедитор (газель)', description: 'Требуется водитель с категорией B, развоз товара по городу.', salary: [35000, 50000] },
    { title: 'Грузчик на постоянной основе', description: 'Разгрузка/погрузка на складе, график 5/2.', salary: [25000, 35000] },
  ],
  'Репетиторы': [
    { title: 'Репетитор по математике в учебный центр', description: 'Группы 5–9 класс, вечерние занятия 3 раза в неделю.', salary: [15000, 30000] },
  ],
  'Красота': [
    { title: 'Мастер маникюра в салон', description: 'Аренда места или % от процедур, готовая клиентская база.', salary: [25000, 60000] },
    { title: 'Парикмахер-универсал', description: 'Требуется мастер с опытом от 1 года, график 2/2.', salary: [20000, 45000] },
  ],
  'Электрика': [
    { title: 'Электрик в обслуживающую компанию', description: 'Обслуживание жилых домов, разъездная работа по городу.', salary: [30000, 45000] },
  ],
  'Сантехника': [
    { title: 'Сантехник в УК', description: 'Обслуживание многоквартирных домов, дежурства по графику.', salary: [28000, 40000] },
  ],
  'Сад и огород': [
    { title: 'Садовник на постоянный участок', description: 'Уход за большим приусадебным участком, 3 дня в неделю.', salary: [15000, 25000] },
  ],
  'Другое': [
    { title: 'Курьер на авто/скутере', description: 'Доставка заказов по городу, свободный график, оплата за смену.', salary: [20000, 35000] },
    { title: 'Няня на неполный день', description: 'Присмотр за ребёнком 5 лет, 3 раза в неделю после обеда.', salary: [12000, 18000] },
  ],
  'Дизайн': [
    { title: 'Графический дизайнер (удалённо)', description: 'Разработка баннеров и креативов для соцсетей, частичная занятость.', salary: [15000, 30000] },
  ],
  'Программирование и IT': [
    { title: 'Frontend-разработчик (удалённо)', description: 'Проекты на React/JS, гибкий график, работа из дома.', salary: [40000, 80000] },
  ],
  'Переводы': [
    { title: 'Переводчик английского языка', description: 'Перевод текстов и документов, оплата за объём выполненной работы.', salary: [15000, 35000] },
  ],
  'Копирайтинг и тексты': [
    { title: 'Копирайтер для интернет-магазина', description: 'Описания товаров и посты для соцсетей, полностью удалённо.', salary: [12000, 25000] },
  ],
  'Онлайн-консультации': [
    { title: 'Юрист-консультант (удалённо)', description: 'Онлайн-консультации клиентов по трудовому и семейному праву.', salary: [20000, 40000] },
  ],
  'Маркетинг и SMM': [
    { title: 'SMM-специалист', description: 'Ведение соцсетей нескольких клиентов, разработка контент-плана.', salary: [18000, 35000] },
  ],
  'Бухгалтерия онлайн': [
    { title: 'Бухгалтер на аутсорс', description: 'Ведение нескольких ИП удалённо, сдача отчётности в налоговую.', salary: [20000, 40000] },
  ],
  'Психология и коучинг': [
    { title: 'Психолог-консультант онлайн', description: 'Приём клиентов по видеосвязи, гибкий график.', salary: [15000, 35000] },
  ],
};

const EXPERIENCE_VALUES = ['no_experience', '1-3', '3-6', '6+'];
const REQUIREMENTS_POOL = [
  'Ответственность и пунктуальность, готовность обучаться.',
  'Опыт работы в аналогичной должности приветствуется.',
  'Умение работать в команде и соблюдать сроки.',
  'Наличие своего инструмента или оборудования, если требуется для работы.',
];
const CONDITIONS_POOL = [
  'Официальное оформление, стабильная оплата 2 раза в месяц.',
  'Гибкий график, возможен частично удалённый формат.',
  'Испытательный срок 1 месяц, дружный коллектив.',
  'Обучение на месте, помощь наставника первое время.',
];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}
function daysAgoTimestamp(days) {
  const d = new Date(Date.now() - days * 86400000 - randInt(0, 80000) * 1000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function main() {
  await db.init();
  const CATEGORIES = await categoriesRepo.listNames();

  console.log('Очищаю старые данные…');
  await db.query('TRUNCATE TABLE reports RESTART IDENTITY CASCADE');
  await db.query('TRUNCATE TABLE orders RESTART IDENTITY CASCADE');
  await db.query('TRUNCATE TABLE vacancies RESTART IDENTITY CASCADE');
  await db.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE');

  const passwordHash = bcrypt.hashSync('password123', 10);
  const adminHash = bcrypt.hashSync('admin12345', 10);

  console.log('Создаю администратора…');
  await db.query(
    `INSERT INTO users (name, email, phone, password_hash, city, role) VALUES ($1, $2, $3, $4, $5, 'admin')`,
    ['Азамат Админов', 'admin@shabashka.kg', '+996700000000', adminHash, 'Бишкек']
  );

  console.log('Создаю пользователей…');
  const userIds = [];
  for (let i = 0; i < CUSTOMERS.length; i++) {
    const [name, slug] = CUSTOMERS[i];
    const city = pick(CITIES);
    const phone = `+9967001${String(10000 + i * 137).slice(-5)}`;
    const inserted = await db.query(
      `INSERT INTO users (name, email, phone, password_hash, city) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, `${slug}@example.com`, phone, passwordHash, city]
    );
    userIds.push({ id: inserted.rows[0].id, name, phone, city });
  }

  console.log('Создаю заказы…');
  const orderIds = [];
  let pinnedCount = 0;
  for (const category of CATEGORIES) {
    const templates = TEMPLATES[category] || TEMPLATES['Другое'];
    for (const t of templates) {
      const owner = pick(userIds);
      const city = Math.random() < 0.6 ? owner.city : pick(CITIES);
      const daysAgo = randInt(0, 40);
      const status = Math.random() < 0.82 ? 'open' : 'closed';
      const pinned = status === 'open' && pinnedCount < 3 && Math.random() < 0.15 ? 1 : 0;
      if (pinned) pinnedCount++;
      const budget = t.budget ? randInt(t.budget[0], t.budget[1]) : null;

      const inserted = await db.query(
        `INSERT INTO orders (user_id, title, description, category, city, work_format, budget, whatsapp_phone, status, views, pinned, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [
          owner.id,
          t.title,
          t.description,
          category,
          city,
          pickWorkFormat(category),
          budget,
          owner.phone,
          status,
          randInt(0, 240),
          pinned,
          daysAgoTimestamp(daysAgo),
        ]
      );
      orderIds.push(inserted.rows[0].id);
    }
  }

  console.log('Создаю вакансии…');
  const vacancyIds = [];
  let vacancyPinnedCount = 0;
  for (const category of CATEGORIES) {
    const templates = VACANCY_TEMPLATES[category] || VACANCY_TEMPLATES['Другое'];
    for (const t of templates) {
      const owner = pick(userIds);
      const city = Math.random() < 0.6 ? owner.city : pick(CITIES);
      const daysAgo = randInt(0, 30);
      const status = Math.random() < 0.85 ? 'open' : 'closed';
      const pinned = status === 'open' && vacancyPinnedCount < 2 && Math.random() < 0.2 ? 1 : 0;
      if (pinned) vacancyPinnedCount++;

      const inserted = await db.query(
        `INSERT INTO vacancies
          (user_id, title, description, category, employment_type, city, work_format, experience,
           requirements, conditions, salary_min, salary_max, schedule, whatsapp_phone, status, views, pinned, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
        [
          owner.id,
          t.title,
          t.description,
          category,
          pick(EMPLOYMENT_VALUES),
          city,
          pickWorkFormat(category),
          pick(EXPERIENCE_VALUES),
          pick(REQUIREMENTS_POOL),
          pick(CONDITIONS_POOL),
          t.salary ? t.salary[0] : null,
          t.salary ? t.salary[1] : null,
          pick(SCHEDULES),
          owner.phone,
          status,
          randInt(0, 180),
          pinned,
          daysAgoTimestamp(daysAgo),
        ]
      );
      vacancyIds.push(inserted.rows[0].id);
    }
  }

  console.log('Добавляю несколько жалоб…');
  const reasons = [
    'Похоже на спам / нереальная цена',
    'Заказчик не отвечает в WhatsApp',
    'Дублирующее объявление',
    'Подозрение на мошенничество',
  ];
  for (let i = 0; i < 4; i++) {
    await db.query('INSERT INTO reports (order_id, reason, resolved) VALUES ($1, $2, $3)', [
      pick(orderIds),
      pick(reasons),
      Math.random() < 0.5 ? 1 : 0,
    ]);
  }

  console.log(`
Готово!
  Пользователей: ${userIds.length + 1} (включая администратора)
  Заказов: ${orderIds.length}
  Вакансий: ${vacancyIds.length}
  Пароль для всех демо-заказчиков: password123
  Админ: admin@shabashka.kg / admin12345
`);

  await db.pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

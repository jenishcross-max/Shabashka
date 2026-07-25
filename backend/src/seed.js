// Заполняет базу реалистичными демо-данными для показа сайта.
// Использование: node src/seed.js
// ВНИМАНИЕ: полностью очищает users/orders/reports перед заполнением.
const bcrypt = require('bcryptjs');
const db = require('./db');
const categoriesRepo = require('./categoriesRepo');
const CATEGORIES = categoriesRepo.listNames();

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
};

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

console.log('Очищаю старые данные…');
db.exec('DELETE FROM reports; DELETE FROM orders; DELETE FROM users;');
db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users','orders','reports')");

const passwordHash = bcrypt.hashSync('password123', 10);
const adminHash = bcrypt.hashSync('admin12345', 10);

console.log('Создаю администратора…');
db.prepare(
  `INSERT INTO users (name, email, phone, password_hash, city, role) VALUES (?, ?, ?, ?, ?, 'admin')`
).run('Азамат Админов', 'admin@shabashka.kg', '+996700000000', adminHash, 'Бишкек');

console.log('Создаю пользователей…');
const userIds = CUSTOMERS.map(([name, slug], i) => {
  const city = pick(CITIES);
  const phone = `+9967001${String(10000 + i * 137).slice(-5)}`;
  const info = db
    .prepare(`INSERT INTO users (name, email, phone, password_hash, city) VALUES (?, ?, ?, ?, ?)`)
    .run(name, `${slug}@example.com`, phone, passwordHash, city);
  return { id: info.lastInsertRowid, name, phone, city };
});

console.log('Создаю заказы…');
const insertOrder = db.prepare(
  `INSERT INTO orders (user_id, title, description, category, city, budget, whatsapp_phone, status, views, pinned, created_at)
   VALUES (@user_id, @title, @description, @category, @city, @budget, @whatsapp_phone, @status, @views, @pinned, @created_at)`
);

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

    const info = insertOrder.run({
      user_id: owner.id,
      title: t.title,
      description: t.description,
      category,
      city,
      budget,
      whatsapp_phone: owner.phone,
      status,
      views: randInt(0, 240),
      pinned,
      created_at: daysAgoTimestamp(daysAgo),
    });
    orderIds.push(info.lastInsertRowid);
  }
}

console.log('Добавляю несколько жалоб…');
const reasons = [
  'Похоже на спам / нереальная цена',
  'Заказчик не отвечает в WhatsApp',
  'Дублирующее объявление',
  'Подозрение на мошенничество',
];
const insertReport = db.prepare('INSERT INTO reports (order_id, reason, resolved) VALUES (?, ?, ?)');
for (let i = 0; i < 4; i++) {
  insertReport.run(pick(orderIds), pick(reasons), Math.random() < 0.5 ? 1 : 0);
}

console.log(`
Готово!
  Пользователей: ${userIds.length + 1} (включая администратора)
  Заказов: ${orderIds.length}
  Пароль для всех демо-заказчиков: password123
  Админ: admin@shabashka.kg / admin12345
`);

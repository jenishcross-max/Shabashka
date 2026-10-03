// Поток из групп до модели (см. handleMessage в src/telegram/sourceWatcher.js):
// сетевой найм и «доверенность на машину» отсеиваются по словам, их номер
// попадает в чёрный список, а одно и то же объявление, разосланное по
// десятку групп, разбирается один раз. Всё это бережёт суточную норму модели.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, statsStub, at, chat, wait } = require('./helpers/stub');

const tg = chat();
const stats = statsStub();
const parsed = [];
const ingested = [];
let answer = () => [];

const requireSrc = install({
  [at('telegram/api.js')]: tg.api,
  [at('telegram/notify.js')]: { ADMIN_IDS: new Set(['1']), isAllowed: () => true, notifyAdmins: async () => {} },
  [at('telegram/extract.js')]: {
    KEY_COUNT: 1,
    PACE_MS: 35000,
    hasPhone: (text) => /\d{3}\s?\d{3}\s?\d{3}/.test(text),
    fromText: async (text) => {
      parsed.push(text);
      return answer(text);
    },
  },
  [at('telegram/bot.js')]: {
    ingestFromSource: async (chatId, listings) => {
      ingested.push(listings);
      return listings.length;
    },
  },
  [at('telegram/feedStats.js')]: stats.feedStats,
  [at('telegram/blocklist.js')]: stats.blocklist,
});

const watcher = requireSrc('telegram/sourceWatcher.js');

let seq = 0;
const post = (text) => watcher.handleMessage({ id: (seq += 1), message: text, date: Math.floor(Date.now() / 1000) });

test('сетевой найм отсеивается без модели, а его номер — в чёрный список', async () => {
  await post(`Ищем Девушек и парней Помощника Администратора в офис! Можно и без опыта — всему научим!
Работа в офисе в центре города. Реальный карьерный рост. Возраст от 16 до 40 лет. 0700 123 456`);
  await wait(10);
  assert.equal(parsed.length, 0, 'к модели не ходили');
  assert.equal(stats.counters['grp.no.mlm'], 1);
  assert.ok(stats.blocked.has('+996700123456'));

  // Назавтра тот же вербовщик пишет другими словами — номер его выдаёт.
  await post('Работа для студентов, звоните 0700123456');
  await wait(10);
  assert.equal(parsed.length, 0);
  assert.equal(stats.counters['grp.blocked'], 1);
});

test('доверенность на машину из Китая отсеивается без модели', async () => {
  await post(
    'Нотариуска барып Китайдан келген машинага доверность жазыш керек. Загс барлар жарабайт. Эч кандай зыяны тийбейт. Акчасы дароо колго берилет 0555 987 654'
  );
  await wait(10);
  assert.equal(parsed.length, 0);
  assert.equal(stats.counters['grp.no.drop'], 1);
});

test('то же объявление из второй группы не разбирается заново', async () => {
  answer = () => [{ is_listing: true, listing_type: 'order', title: 'Сантехник', phone: '+996700111222' }];
  await post('Нужен сантехник, поменять смеситель, Восток-5. 0700 111 222');
  await wait(20);
  assert.equal(parsed.length, 1);
  assert.equal(ingested.length, 1);

  // Другие эмодзи и пробелы — тот же текст.
  await post('🔥 Нужен сантехник,  поменять смеситель, Восток-5!! 0700 111 222');
  await wait(20);
  assert.equal(parsed.length, 1, 'повтор к модели не пошёл');
  assert.equal(stats.counters['grp.dup'], 1);
});

test('что не взяла модель — в сводку по причинам; сетевое после модели — ещё и в чёрный список', async () => {
  answer = () => [
    { is_listing: false, listing_type: 'other', title: 'Работа', note: 'не указана должность' },
    { is_listing: false, listing_type: 'other', title: 'Оформление', note: 'оформление машин или документов на чужое имя', spam: 'drop', phone: '+996777000111' },
  ];
  await post('Какое-то объявление, которое разберёт модель, 0777 000 111');
  await wait(20);
  assert.equal(stats.counters['grp.no.other'], 1);
  assert.equal(stats.counters['grp.no.drop'], 2);
  assert.ok(stats.blocked.has('+996777000111'));
  assert.equal(ingested.length, 1, 'публиковать было нечего');
});

test('повтор узнаётся по тексту и забывается через срок', () => {
  const now = Date.now();
  assert.equal(watcher.repeated('Продаю велосипед 0700222333', now), false);
  assert.equal(watcher.repeated('продаю   велосипед! 0700222333', now + 1000), true);
  assert.equal(watcher.repeated('Продаю велосипед 0700222333', now + 13 * 3600 * 1000), false, 'через 12 часов — уже не повтор');
});

test('номер группы в подписи поста в чёрный список не попадает — вместе с ним замолчала бы вся группа', async () => {
  const before = stats.blocked.size;
  await post(
    'Сетевой бизнес! Ищу партнёров в команду, пассивный доход. Звоните 0700 444 555\nПо рекламе в группе: 0555 000 000'
  );
  await wait(10);
  assert.equal(stats.blocked.size, before, 'два номера — неизвестно, чей; не запоминаем ни один');
  assert.ok(!stats.blocked.has('+996555000000'));
});

test('разбор упал на лимите — повтор того же текста разбирается заново', async () => {
  const limited = new Error('суточная норма разбора выбрана');
  limited.rateLimited = true;
  answer = () => {
    throw limited;
  };
  const before = parsed.length;
  await post('Требуется сварщик на объект, Аламедин, 2500 сом в день, 0700 999 888');
  await wait(20);
  assert.equal(parsed.length, before + 1);

  answer = () => [{ is_listing: true, listing_type: 'order', title: 'Сварщик', phone: '+996700999888' }];
  await post('Требуется сварщик на объект, Аламедин, 2500 сом в день, 0700 999 888');
  await wait(20);
  assert.equal(parsed.length, before + 2, 'после неудачи повтор не считается уже виденным');
});

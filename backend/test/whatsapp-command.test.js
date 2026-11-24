// Команда /whatsapp в боте (см. src/whatsapp/index.js): состояние канала, код
// привязки второго номера и подборка вне расписания. Подключение и подборки
// подменены — у них свои тесты (whatsapp-channel, whatsapp-digest).
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');

process.env.WA_CHANNEL = 'https://whatsapp.com/channel/0029VbDkFgd90x2sGL6f6m0p';
process.env.WA_PHONE = '996700123456';

const fake = {
  info: { status: 'open', name: 'Жумуш | Работа | Шабашка', lastError: '', phone: '996700123456' },
  code: 'ABCD1234',
  posted: [],
  options: null,
  followers: async () => 58,
};
const published = [];
const requireSrc = install({
  [at('whatsapp/channel.js')]: {
    createChannel: (options) => {
      fake.options = options;
      return {
        enabled: true,
        start: () => {},
        link: async () => fake.code,
        post: async (text) => fake.posted.push(text),
        info: () => fake.info,
        followers: () => fake.followers(),
      };
    },
  },
  [at('whatsapp/digest.js')]: {
    HOURS: [9, 12, 15, 18, 21],
    ORDERS_HOUR: 15,
    start: () => {},
    publish: async (deps) => {
      published.push(deps);
      await deps.post('подборка');
      return published.length === 1 ? 'ok' : 'skip';
    },
  },
  [at('telegram/notify.js')]: { notifyAdmins: async () => {} },
  [at('telegram/api.js')]: { esc: (s) => String(s ?? '').replace(/</g, '&lt;') },
});
const whatsapp = requireSrc('whatsapp/index.js');

test('канал и номер — из WA_CHANNEL и WA_PHONE', () => {
  assert.equal(fake.options.invite, process.env.WA_CHANNEL);
  assert.equal(fake.options.phone, '996700123456');
});

test('/whatsapp — состояние, канал, расписание и что можно сделать', async () => {
  const text = await whatsapp.command('');
  assert.match(text, /✅ подключён/);
  assert.match(text, /Жумуш \| Работа \| Шабашка/);
  assert.match(text, /9:00, 12:00, 15:00, 18:00, 21:00 \(в 15:00 — подработка\)/);
  assert.match(text, /\/whatsapp link/);
  assert.match(text, /\/whatsapp now/);
});

test('/whatsapp link — код по четыре знака и где его ввести', async () => {
  fake.info = { ...fake.info, status: 'unlinked' };
  const text = await whatsapp.command('link');
  assert.match(text, /<b>ABCD-1234<\/b>/);
  assert.match(text, /\+996700123456/);
  assert.match(text, /Привязать по номеру телефона/);

  fake.code = null;
  assert.match(await whatsapp.command('link'), /уже привязан/);
});

test('/whatsapp now — подборка уходит в канал сразу; мало вакансий — так и сказано', async () => {
  whatsapp.start({ siteUrl: () => 'https://xn--80aaac0cyed.com/vacancies', pretty: (url) => url });
  assert.match(await whatsapp.command('now'), /✅ Подборка ушла в канал/);
  assert.deepEqual(fake.posted, ['подборка'], 'подборка — через подключение к каналу');
  assert.match(await whatsapp.command('now'), /меньше трёх/);
});

test('ошибка показана, но без HTML-разметки из неё', async () => {
  fake.info = { ...fake.info, status: 'connecting', lastError: 'Connection <Failure>' };
  assert.match(await whatsapp.command(''), /Последняя ошибка: Connection &lt;Failure>/);
});

// Подписчики канала — для сводки (см. telegram/summary.js). Сводка не должна ждать
// WhatsApp: не подключён — сразу null, завис — null через waitMs.
test('подписчики канала для сводки — без долгого ожидания', async () => {
  fake.info = { ...fake.info, status: 'open' };
  assert.equal(await whatsapp.followers(), 58);

  fake.info = { ...fake.info, status: 'connecting' };
  let asked = 0;
  fake.followers = async () => {
    asked += 1;
    return 58;
  };
  assert.equal(await whatsapp.followers(), null, 'не подключён — не будим ради сводки');
  assert.equal(asked, 0);

  fake.info = { ...fake.info, status: 'open' };
  fake.followers = () => new Promise(() => {});
  assert.equal(await whatsapp.followers({ waitMs: 20 }), null, 'завис — сводка идёт без WhatsApp');

  fake.followers = async () => {
    throw new Error('rate-overlimit');
  };
  assert.equal(await whatsapp.followers(), null, 'ошибка — тоже просто без числа');
});

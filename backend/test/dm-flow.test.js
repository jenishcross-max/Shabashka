// ИИ-продавец в директе целиком (см. src/dm/index.js): от «сколько стоит
// реклама?» до ссылки на вышедший пост и отчёта через сутки.
//
// Модель здесь — сценарий: что она «поняла» из сообщения, задаёт тест. База —
// разговоры в памяти. Проверяется то, что делает сам продавец: кому он вообще
// отвечает, что пишет, когда публикует, когда замолкает и что говорит админу.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');

process.env.AD_PRICE = '50';
process.env.AD_VIEWS_GOAL = '1000';
process.env.MBANK_NUMBER = '0700 123 456';
process.env.MBANK_NAME = 'Жениш Ш.';

// Разговоры, очередь исходящих и чеки — в памяти, тем же набором функций,
// что у src/dm/store.js.
function memoryStore() {
  const chats = [];
  const outbox = [];
  const receipts = new Set();
  let seq = 0;
  const copy = (chat) => (chat ? JSON.parse(JSON.stringify({ ...chat, ad_image: null })) : null);
  const withImage = (chat) => chat && { ...copy(chat), ad_image: chat.ad_image };
  return {
    chats,
    outbox,
    get: async (channel, peer) => withImage(chats.find((c) => c.channel === channel && c.peer === peer)),
    byId: async (id) => withImage(chats.find((c) => c.id === id)),
    create: async (channel, peer, name) => {
      const chat = {
        id: (seq += 1),
        channel,
        peer,
        peer_name: name || null,
        stage: 'new',
        lang: 'ru',
        ad_text: null,
        ad_image: null,
        history: [],
        seen: [],
        payment: null,
        receipt_fails: 0,
        paused_until: null,
        campaign_id: null,
        updated_at: new Date(),
      };
      chats.push(chat);
      return withImage(chat);
    },
    save: async (chat) => {
      const i = chats.findIndex((c) => c.id === chat.id);
      chats[i] = { ...chat, updated_at: new Date() };
    },
    byCampaign: async (id) => withImage(chats.find((c) => c.campaign_id === id)),
    recent: async () => chats.map(copy),
    peers: async () => chats.map((c) => c.peer),
    queue: async (chatId, text) => {
      outbox.push({ id: outbox.length + 1, chatId, text, sent: false });
    },
    outbox: async () => outbox.filter((o) => !o.sent),
    sent: async (id) => {
      outbox.find((o) => o.id === id).sent = true;
    },
    receiptSeen: async (keys) => keys.some((k) => receipts.has(k)),
    rememberReceipt: async (keys) => keys.forEach((k) => receipts.add(k)),
  };
}

const store = memoryStore();
// Что «поняла» модель: по тексту сообщения — ответ, по картинке — чек.
let understand = () => ({ intent: 'other' });
let seeImage = () => ({ kind: 'photo' });
let visionDown = false;

const requireSrc = install({
  [at('dm/store.js')]: store,
  [at('telegram/extract.js')]: {
    complete: async (system, content, opts = {}) => {
      if (opts.vision) {
        if (visionDown) throw new Error('лимит');
        return seeImage();
      }
      const text = String(content).split('Последнее сообщение человека:\n')[1] || '';
      return { lang: 'ru', ad_text: '', forbidden: false, answer: '', ...understand(text) };
    },
  },
});

const dm = requireSrc('dm/index.js');
const published = [];
const admin = [];
dm.start({
  publish: async ({ chat, text, image }) => {
    published.push({ peer: chat.peer, text, image: Boolean(image) });
    return { threads: true, siteLink: 'шабашка.com/board#p1' };
  },
  admin: async (event) => admin.push(event.type),
});

let keySeq = 0;
const them = (text, extra = {}) => ({ key: `m${(keySeq += 1)}`, from: 'them', text, ...extra });
const me = (text) => ({ key: `m${(keySeq += 1)}`, from: 'me', text });
const IMAGE = `data:image/jpeg;base64,${Buffer.from('скриншот чека').toString('base64')}`;
const settle = () => new Promise((r) => setImmediate(r));

// Переписка целиком, как её видит расширение: всё, что было, плюс новое.
const threads = new Map();
async function say(peer, messages, { request = true } = {}) {
  const log = threads.get(peer) || [];
  log.push(...messages);
  const { replies, ignored, paused } = await dm.sync({ peer, request, messages: log });
  for (const reply of replies) log.push(me(reply));
  threads.set(peer, log);
  return { replies, ignored, paused, text: replies.join('\n') };
}

test('чужая переписка из общей папки директа боту не нужна', async () => {
  const out = await say('drug', [them('Привет, как дела?')], { request: false });
  assert.equal(out.ignored, true);
  assert.equal(store.chats.length, 0, 'разговор даже не заведён');
});

test('полный путь: цена → номер МБанка → чек → публикация → ссылка → отчёт', async () => {
  understand = (text) =>
    /сколько/i.test(text)
      ? { intent: 'ad' }
      : /^да/i.test(text)
        ? { intent: 'agree' }
        : { intent: 'ad', ad_text: text };

  const offer = await say('client', [them('Сколько стоит реклама?')]);
  assert.match(offer.text, /50 сом/);
  assert.match(offer.text, /Размещаем\?/);
  assert.doesNotMatch(offer.text, /0700/, 'номер для оплаты — только после согласия');

  const pay = await say('client', [them('Да')]);
  assert.match(pay.text, /0700 123 456 \(Жениш Ш\.\)/);
  assert.match(pay.text, /текст объявления/, 'текста ещё нет — просим и его');

  const got = await say('client', [them('Требуется повар в кафе, график 2/2, 0555 111 222')]);
  assert.match(got.text, /скриншот чека/);

  seeImage = () => ({
    kind: 'receipt',
    success: true,
    amount: 50,
    currency: 'KGS',
    recipient: 'Жениш Ш.',
    account: '+996 700 *** 456',
    datetime: new Date().toISOString().slice(0, 16).replace('T', ' '),
    operation_id: '555001',
  });
  const paid = await say('client', [them('', { image: IMAGE })]);
  assert.match(paid.text, /Оплату вижу/);
  await settle();
  assert.deepEqual(published, [{ peer: 'client', text: 'Требуется повар в кафе, график 2/2, 0555 111 222', image: false }]);
  assert.ok(admin.includes('paid'), 'копия чека — админу');

  const chat = store.chats.find((c) => c.peer === 'client');
  await dm.onPosted(chat.id, 'https://www.threads.com/@shabashka/post/ABC', 7);
  const [link] = await dm.outbox();
  assert.match(link.text, /Готово! Ваша реклама вышла: https:\/\/www\.threads\.com/);
  await dm.sent(link.id);

  assert.equal(await dm.onReport(7, { views: 1500, likes: 20, replies: 3 }, 1000), 'sent');
  const [report] = await dm.outbox();
  assert.match(report.text, /1\s500 просмотров/);
  assert.equal(await dm.onReport(99, { views: 10 }, 1000), null, 'чужая реклама — не наша забота');
});

test('ответы бота, которые расширение отправило, не считаются вмешательством владельца', async () => {
  const chat = store.chats.find((c) => c.peer === 'client');
  assert.equal(chat.paused_until, null);
});

test('тот же чек второй раз не принимается', async () => {
  understand = () => ({ intent: 'agree' });
  await say('client', [them('Хочу ещё одну рекламу, да')]);
  const again = await say('client', [them('', { image: IMAGE })]);
  assert.match(again.text, /уже присылали/);
  assert.equal(published.length, 1, 'второй публикации нет');
});

test('принявшему нас за работодателя — объяснение', async () => {
  understand = () => ({ intent: 'job' });
  const out = await say('seeker', [them('Здравствуйте, вакансия повара ещё актуальна? Куда звонить?')]);
  assert.match(out.text, /Мы не работодатель/);
  assert.match(out.text, /номеру, который указан в посте/);
});

test('владелец написал сам — бот в разговоре замолкает', async () => {
  understand = () => ({ intent: 'ad' });
  await say('vip', [them('Сколько стоит реклама?')]);
  await say('vip', [me('Для вас скидка, 40 сом')]);
  const out = await say('vip', [them('Отлично, спасибо!')]);
  assert.deepEqual(out.replies, []);
  assert.equal(out.paused, true);
});

test('уже разобранное второй раз не разбирается', async () => {
  const before = store.chats.find((c) => c.peer === 'seeker').history.length;
  const { replies } = await dm.sync({ peer: 'seeker', request: true, messages: threads.get('seeker') });
  assert.deepEqual(replies, []);
  assert.equal(store.chats.find((c) => c.peer === 'seeker').history.length, before);
});

test('просит человека — админу, и бот молчит', async () => {
  understand = () => ({ intent: 'human' });
  const out = await say('angry', [them('Я заплатил вчера, где моя реклама?! Верните деньги')]);
  assert.match(out.text, /администратору/);
  assert.ok(admin.includes('handoff'));
  understand = () => ({ intent: 'ad' });
  const later = await say('angry', [them('Алло?')]);
  assert.deepEqual(later.replies, [], 'дальше отвечает админ');
});

test('картинку модель не посмотрела — на стадии оплаты это чек, и он идёт админу', async () => {
  understand = (text) => (/^да/i.test(text) ? { intent: 'agree' } : { intent: 'ad' });
  await say('late', [them('Сколько стоит реклама?')]);
  await say('late', [them('да')]);
  visionDown = true;
  const out = await say('late', [them('', { image: `data:image/jpeg;base64,${Buffer.from('другой чек').toString('base64')}` })]);
  visionDown = false;
  assert.match(out.text, /Проверяю оплату/);
  assert.ok(admin.includes('review'));

  const chat = store.chats.find((c) => c.peer === 'late');
  assert.equal(await dm.approve(chat.id), 'жду текст объявления');
  const pending = await dm.outbox();
  assert.match(pending.at(-1).text, /Теперь пришлите текст объявления/);
});

test('без модели бот всё равно отвечает — по словам', async () => {
  understand = () => {
    throw new Error('лимиты');
  };
  const out = await say('nomodel', [them('Сколько стоит реклама?')]);
  assert.match(out.text, /50 сом/);
});

test('свой ответ узнаётся, даже если эмодзи Threads нарисовал картинкой', () => {
  const bot = ['Оплату вижу ✅ Спасибо! Публикую — ссылку на пост пришлю сюда через несколько минут.'].map((t) =>
    t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  );
  assert.equal(dm.isBotText('Оплату вижу  Спасибо! Публикую — ссылку на пост пришлю сюда через несколько минут.', bot), true);
  assert.equal(dm.isBotText('Для вас скидка, 40 сом', bot), false);
});

test('сетевой найм в директе не продаём, даже если модель его пропустила', async () => {
  understand = (text) => ({ intent: 'ad', ad_text: text, forbidden: false });
  const out = await say('setevik', [
    them(
      'Хочу рекламу: Ищем девушек и парней, помощник администратора в офис, без опыта, всему научим, карьерный рост, от 16 до 40 лет. 0700123456'
    ),
  ]);
  assert.match(out.text, /не публикуем/i);
  assert.doesNotMatch(out.text, /0700 123 456/, 'номер для оплаты не дали');
  assert.equal(store.chats.find((c) => c.peer === 'setevik').stage, 'declined');
});

test('решение админа по чеку не теряется, если в ту же минуту пришло сообщение', async () => {
  understand = () => ({ intent: 'greeting' });
  await say('racer', [them('Здравствуйте')]);
  const row = store.chats.find((c) => c.peer === 'racer');
  Object.assign(row, { stage: 'checking', ad_text: 'Продаю диван, 0700111222' });

  // sync прочитал разговор и «думает», а админ в это время жмёт ✅.
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const origGet = store.get;
  store.get = async (...args) => {
    const chat = await origGet(...args);
    await gate;
    return chat;
  };
  understand = () => ({ intent: 'other' });
  const syncing = say('racer', [them('ну что там?')]);
  await settle();
  const approving = dm.approve(row.id);
  await settle();
  release();
  await Promise.all([syncing, approving]);
  store.get = origGet;

  const after = store.chats.find((c) => c.peer === 'racer');
  assert.notEqual(after.stage, 'checking', 'сохранение sync не вернуло старую стадию');
});

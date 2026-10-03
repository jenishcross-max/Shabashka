// Логика разговора ИИ-продавца в директе (см. decide в src/dm/agent.js).
//
// Модель только понимает, чего хочет человек; куда двигать разговор, решает
// код. Здесь проверяется то, за что платят деньгами и репутацией: номер для
// оплаты уходит только после согласия, публикация — только после принятого
// чека, запрещённое не выкладывается, а тот, кто принял Шабашку за
// работодателя, получает объяснение, а не прайс.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');

// Модель здесь не нужна: проверяются правила, а не её ответы.
// Что бот просил у модели — чтобы проверить, когда ему можно резерв лесенки.
const asked = [];
const requireSrc = install({
  [at('telegram/extract.js')]: {
    complete: async (system, content, opts) => {
      asked.push(opts);
      return {};
    },
  },
});
const agent = requireSrc('dm/agent.js');

const state = (extra = {}) => ({ stage: 'new', hasText: false, hasImage: false, fails: 0, mbank: true, ...extra });
const keys = (out) => out.say.map((s) => s.key);

test('вопрос про рекламу — цена и «размещаем?», реквизитов ещё нет', () => {
  const out = agent.decide(state(), { intent: 'ad' });
  assert.deepEqual(keys(out), ['offer']);
  assert.equal(out.stage, 'offered');
  assert.deepEqual(out.actions, []);
});

test('согласие — номер МБанка; текста нет — просим и его', () => {
  const out = agent.decide(state({ stage: 'offered' }), { intent: 'agree' });
  assert.deepEqual(keys(out), ['payment']);
  assert.deepEqual(out.say[0].vars, { needText: true });
  assert.equal(out.stage, 'awaiting_payment');
});

test('согласие без номера МБанка в настройках — зовём админа, а не выдумываем реквизиты', () => {
  const out = agent.decide(state({ stage: 'offered', mbank: false }), { intent: 'agree' });
  assert.deepEqual(keys(out), ['noMbank']);
  assert.deepEqual(out.actions, ['noMbank']);
});

test('присланное объявление до оплаты запоминается, и снова предлагаем цену', () => {
  const out = agent.decide(state(), { intent: 'ad', adText: 'Требуется повар, 0700 123 456' });
  assert.deepEqual(keys(out), ['offer']);
  assert.deepEqual(out.say[0].vars, { got: true });
  assert.equal(out.stage, 'offered');
});

test('принятый чек при готовом тексте — публикация и копия чека админу', () => {
  const out = agent.decide(state({ stage: 'awaiting_payment', hasText: true }), { receipt: { ok: true } });
  assert.deepEqual(keys(out), ['paidPublishing']);
  assert.deepEqual(out.actions, ['paid', 'publish']);
  assert.equal(out.stage, 'publishing');
});

test('принятый чек без текста — ждём текст, потом публикуем', () => {
  const paid = agent.decide(state({ stage: 'awaiting_payment' }), { receipt: { ok: true } });
  assert.deepEqual(keys(paid), ['paidNeedText']);
  assert.equal(paid.stage, 'awaiting_text');
  assert.ok(!paid.actions.includes('publish'));

  const text = agent.decide(state({ stage: 'awaiting_text' }), { intent: 'ad', adText: 'Продаю кирпич, 0555 000 111' });
  assert.deepEqual(keys(text), ['publishingNow']);
  assert.deepEqual(text.actions, ['publish']);
});

test('без чека публикации нет, что бы человек ни писал', () => {
  for (const intent of ['agree', 'paid', 'ad', 'question', 'greeting']) {
    const out = agent.decide(state({ stage: 'awaiting_payment', hasText: true }), { intent, answer: 'ответ' });
    assert.ok(!out.actions.includes('publish'), intent);
  }
  const paidWords = agent.decide(state({ stage: 'awaiting_payment', hasText: true }), { intent: 'paid' });
  assert.deepEqual(keys(paidWords), ['askReceipt'], '«я оплатил» без чека — просим чек');
});

test('плохой чек — объясняем почему; второй плохой — отдаём админу на проверку', () => {
  const first = agent.decide(state({ stage: 'awaiting_payment' }), { receipt: { ok: false, reason: 'amount' } });
  assert.deepEqual(keys(first), ['receiptBad']);
  assert.equal(first.say[0].vars.reason, 'amount');
  assert.equal(first.fails, 1);

  const second = agent.decide(state({ stage: 'awaiting_payment', fails: 1 }), { receipt: { ok: false, reason: 'old' } });
  assert.deepEqual(keys(second), ['checking']);
  assert.deepEqual(second.actions, ['review']);
  assert.equal(second.stage, 'checking');
});

test('чек, который модель не прочитала, идёт админу, а не теряется', () => {
  const out = agent.decide(state({ stage: 'awaiting_payment' }), { receipt: { review: true } });
  assert.deepEqual(keys(out), ['checking']);
  assert.deepEqual(out.actions, ['review']);
});

test('принявшему нас за работодателя — объяснение, стадия не меняется', () => {
  for (const stage of ['new', 'offered', 'awaiting_payment']) {
    const out = agent.decide(state({ stage }), { intent: 'job' });
    assert.deepEqual(keys(out), ['job']);
    assert.equal(out.stage, stage);
  }
});

test('запрещённое не публикуем и платёж за него не берём', () => {
  const out = agent.decide(state(), { intent: 'ad', adText: 'Работа в Корее, визы', forbidden: true });
  assert.deepEqual(keys(out), ['forbidden']);
  assert.equal(out.stage, 'declined');
  assert.ok(!out.actions.includes('publish'));
});

test('«запрещено» у вопроса без объявления не срабатывает', () => {
  const out = agent.decide(state(), { intent: 'job', forbidden: true });
  assert.deepEqual(keys(out), ['job']);
});

test('человек, жалоба или вопрос без ответа — зовём админа', () => {
  assert.deepEqual(agent.decide(state(), { intent: 'human' }).actions, ['handoff']);
  const noAnswer = agent.decide(state({ stage: 'offered' }), { intent: 'question', answer: '' });
  assert.deepEqual(keys(noAnswer), ['handoff']);
  const answered = agent.decide(state({ stage: 'offered' }), { intent: 'question', answer: 'Да, с фото можно.' });
  assert.deepEqual(keys(answered), ['answer']);
});

test('после вышедшей рекламы новая начинается с чистого листа', () => {
  const out = agent.decide(state({ stage: 'published', hasText: true }), { intent: 'agree' });
  assert.ok(out.actions.includes('reset'));
  assert.deepEqual(keys(out), ['payment']);
  assert.deepEqual(out.say[0].vars, { needText: true }, 'старый текст второй раз не выкладываем');

  const paid = agent.decide(state({ stage: 'published', hasText: true }), { receipt: { ok: true } });
  assert.deepEqual(keys(paid), ['paidNeedText']);
  assert.ok(!paid.actions.includes('publish'));
});

test('спам и эмодзи — молчим', () => {
  const out = agent.decide(state(), { intent: 'other' });
  assert.deepEqual(out.say, []);
});

test('второй чек, пока первый на проверке, не проходит мимо молча', () => {
  const out = agent.decide(state({ stage: 'checking' }), { receipt: { ok: true } });
  assert.deepEqual(keys(out), ['stillChecking']);
  assert.deepEqual(out.actions, []);
});

test('без модели главные развилки понимаются по словам', () => {
  assert.equal(agent.byRules('Сколько стоит реклама?').intent, 'ad');
  assert.equal(agent.byRules('да').intent, 'agree');
  assert.equal(agent.byRules('Я перевёл деньги').intent, 'paid');
  assert.equal(agent.byRules('Вакансия ещё актуальна?').intent, 'job');
  assert.equal(agent.byRules('нет спасибо').intent, 'decline');
  assert.equal(agent.byRules('Жарнама канча турат?').lang, 'ky');
  assert.equal(agent.byRules('непонятно что').intent, 'human', 'непонятное — админу');
});

test('ответ модели с выдуманным номером человеку не уходит', () => {
  assert.equal(agent.safeAnswer('Переведите на 0700 123 456'), '');
  assert.equal(agent.safeAnswer('Да, можно с фото.'), 'Да, можно с фото.');
});

test('каждая реплика есть по-русски и по-кыргызски, без дыр вместо цифр', () => {
  process.env.MBANK_NUMBER = '0700 123 456';
  const texts = requireSrc('dm/texts.js');
  const vars = { reason: 'amount', link: 'https://threads.com/p', views: 1500, likes: 3, replies: 1, text: 'ответ', got: true, needText: true };
  for (const lang of ['ru', 'ky']) {
    for (const key of texts.KEYS) {
      const text = texts.render(key, lang, vars);
      assert.ok(text && !/undefined|NaN|null/.test(text), `${lang}/${key}: ${text}`);
    }
  }
  assert.match(texts.render('payment', 'ky', {}), /0700 123 456/);
});

test('резерв лесенки — только когда разговор уже про оплату', async () => {
  asked.length = 0;
  await agent.classify({ history: [], stage: 'new', text: 'жумуш барбы?' });
  await agent.classify({ history: [], stage: 'offered', text: 'сколько стоит?' });
  await agent.classify({ history: [], stage: 'awaiting_payment', text: 'оплатил' });
  assert.deepEqual(
    asked.map((o) => o.kind),
    ['background', 'background', 'ad']
  );
});

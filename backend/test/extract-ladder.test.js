// Лесенка моделей Groq (см. modelLadder, modelsFor и ask в
// src/telegram/extract.js).
//
// Суточная норма у Groq считается на модель, а не на ключ целиком. Раньше бот
// знал одну модель и, выбрав её, стоял до утра — вместе с платной рекламой,
// хотя у других моделей на тех же ключах нормы лежали нетронутыми. Здесь
// проверяется, что бот спускается по лесенке, что последняя модель остаётся
// рекламе и что отказ «Request too large … (TPD)» он больше не принимает за
// слишком длинное объявление.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');

process.env.GROQ_API_KEY = 'ключ-а,ключ-б';
process.env.GROQ_MODELS = 'qwen/qwen3.8-27b,openai/gpt-oss-20b,llama-3.3-70b-versatile,openai/gpt-oss-120b';
delete process.env.FALLBACK_API_URL;

const requireSrc = install({
  [at('categoriesRepo.js')]: { listNames: async () => ['Другое'] },
  [at('telegram/notify.js')]: { ADMIN_IDS: new Set(['1']), isAllowed: () => true, notifyAdmins: async () => {} },
});

// Что отвечает Groq: по паре «ключ + модель» — «ok» или отказ.
let refuse = () => null;
const asked = [];

const headers = {
  get: (name) =>
    ({ 'x-ratelimit-remaining-tokens': '8000', 'x-ratelimit-reset-tokens': '1s' })[name] ?? null,
};

const daily429 = (model) => ({
  ok: false,
  status: 429,
  headers,
  json: async () => ({
    error: {
      message: `Rate limit reached for model \`${model}\` in organization \`org_x\` service tier \`on_demand\` on tokens per day (TPD): Limit 200000, Used 199145, Requested 2419. Please try again in 11m15.648s.`,
    },
  }),
});

// Так Groq отвечает, когда до конца суточной нормы осталось меньше, чем
// просит разбор. Бот принимал это за слишком длинное объявление.
const daily413 = (model) => ({
  ok: false,
  status: 413,
  headers,
  json: async () => ({
    error: {
      message: `Request too large for model \`${model}\` in organization \`org_x\` service tier \`on_demand\` on tokens per day (TPD): Limit 200000, Requested 4400, please reduce your message size and try again.`,
    },
  }),
});

global.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  const key = options.headers.Authorization.replace('Bearer ', '');
  asked.push({ key, model: body.model, reasoning: body.reasoning_effort });
  const refusal = refuse(key, body.model);
  if (refusal) return refusal;
  return {
    ok: true,
    status: 200,
    headers,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              listings: [{ is_listing: true, listing_type: 'order', title: body.model, phone: '0700111222' }],
            }),
          },
        },
      ],
      usage: { total_tokens: 4000 },
    }),
  };
};

const extract = requireSrc('telegram/extract.js');
const TEXT = 'нужен сантехник поменять кран 0700111222';

const parse = async (opts) => {
  asked.length = 0;
  try {
    return { listing: (await extract.fromText(TEXT, opts))[0] };
  } catch (err) {
    return { err };
  }
};

test('пока норма цела, разбор идёт на первой модели', async () => {
  refuse = () => null;
  const { listing } = await parse({});
  assert.equal(listing.title, 'qwen/qwen3.8-27b');
  assert.equal(asked.length, 1);
});

test('каждой модели — свои размышления: у llama поля нет вовсе, у gpt-oss минимум', async () => {
  // Выбираем всё, кроме llama, чтобы разбор дошёл именно до неё.
  refuse = (key, model) => (model === 'llama-3.3-70b-versatile' ? null : daily429(model));
  const { listing } = await parse({});
  assert.equal(listing.title, 'llama-3.3-70b-versatile');
  const byModel = Object.fromEntries(asked.map((a) => [a.model, a.reasoning]));
  assert.equal(byModel['qwen/qwen3.8-27b'], 'none');
  assert.equal(byModel['openai/gpt-oss-20b'], 'low', 'на «none» gpt-oss отвечает 400');
  assert.equal(byModel['llama-3.3-70b-versatile'], undefined, 'на reasoning_effort llama отвечает 400');
});

test('выбранную модель бот запоминает и больше не спрашивает до её срока', async () => {
  // После прошлого теста qwen и gpt-oss-20b выбраны на обоих ключах.
  refuse = () => null;
  const { listing } = await parse({});
  assert.equal(listing.title, 'llama-3.3-70b-versatile', 'сразу на свободную модель');
  assert.deepEqual(
    [...new Set(asked.map((a) => a.model))],
    ['llama-3.3-70b-versatile'],
    'к выбранным моделям лишних запросов нет'
  );
  const status = Object.fromEntries(extract.usage().models.map((m) => [m.model, m]));
  assert.ok(status['qwen/qwen3.8-27b'].until > Date.now(), 'в /stats видно, до какого часа модель выбрана');
  assert.equal(status['openai/gpt-oss-120b'].reserve, true, 'и какая из них — резерв');
  assert.equal(status['llama-3.3-70b-versatile'].until, null);
});

test('посты из групп резервную модель не трогают, реклама — берёт', async () => {
  // Выбираем и llama: из обычных моделей не остаётся ни одной.
  refuse = (key, model) => (model === 'openai/gpt-oss-120b' ? null : daily429(model));
  const background = await parse({ background: true });
  assert.ok(background.err, 'пост из группы не разобран');
  assert.equal(background.err.rateLimited, true, 'но и не потерян: отказ временный');
  assert.ok(background.err.retryAt > Date.now(), 'и назван срок');
  assert.match(background.err.message, /держу под платную рекламу/);
  assert.ok(!asked.some((a) => a.model === 'openai/gpt-oss-120b'), 'к резерву пост из группы даже не ходил');

  const ad = await parse({ ad: true });
  assert.equal(ad.listing.title, 'openai/gpt-oss-120b', 'реклама разобрана на резервной модели');

  const manual = await parse({});
  assert.equal(manual.listing.title, 'openai/gpt-oss-120b', 'пересланное админом — тоже');
});

test('когда выбрано всё, отказ временный, со сроком первой освободившейся модели', async () => {
  refuse = (key, model) => daily429(model);
  const { err } = await parse({ ad: true });
  assert.ok(err);
  assert.equal(err.rateLimited, true);
  const minutes = (err.retryAt - Date.now()) / 60000;
  assert.ok(minutes > 5 && minutes < 20, `срок из «try again in 11m15s», а вышло ${minutes} мин`);
});

test('по истечении срока модель снова в деле', async () => {
  refuse = () => null;
  const realNow = Date.now;
  Date.now = () => realNow() + 30 * 60 * 1000;
  try {
    const { listing } = await parse({});
    assert.equal(listing.title, 'qwen/qwen3.8-27b', 'через полчаса снова на основной модели');
  } finally {
    Date.now = realNow;
  }
});

test('первой пробуется лучшая модель на всех ключах, и только потом следующая', async () => {
  // Норма qwen выбрана только на первом ключе — второй её ещё тянет.
  const fresh = require('path').resolve(at('telegram/extract.js'));
  delete require.cache[fresh];
  const ex = require(fresh);
  refuse = (key, model) => (key === 'ключ-а' && model === 'qwen/qwen3.8-27b' ? daily429(model) : null);
  asked.length = 0;
  const [listing] = await ex.fromText(TEXT);
  assert.equal(listing.title, 'qwen/qwen3.8-27b', 'основная модель на втором ключе, а не gpt-oss на первом');
});

test('«Request too large … (TPD)» — это выбранная норма, а не длинное объявление', async () => {
  const fresh = require('path').resolve(at('telegram/extract.js'));
  delete require.cache[fresh];
  const ex = require(fresh);
  refuse = (key, model) => (model === 'qwen/qwen3.8-27b' ? daily413(model) : null);
  asked.length = 0;
  const [listing] = await ex.fromText(TEXT);
  assert.equal(listing.title, 'openai/gpt-oss-20b', 'разбор ушёл на следующую модель');
  const maxAsked = new Set(asked.filter((a) => a.model === 'qwen/qwen3.8-27b').map((a) => a.key));
  assert.equal(maxAsked.size, 2, 'qwen спросили на обоих ключах — по разу, без урезания ответа');
});

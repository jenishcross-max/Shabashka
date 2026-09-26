// Groq снимает preview-модели без предупреждения. Так в сентябре 2026 пропала
// qwen/qwen3.6-27b: на каждое объявление приходило «model does not exist», и за
// шесть часов из групп не вышло ни одного. Бот должен переживать это сам —
// перейти на запасную модель из production и сказать об этом админу
// (см. modelGone и switchModel в src/telegram/extract.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');

process.env.GROQ_API_KEY = 'ключ-для-теста';
// Лесенка из двух моделей: основная пропала — остаётся запасная.
process.env.GROQ_MODELS = 'qwen/qwen3.8-27b,openai/gpt-oss-120b';
process.env.GROQ_DAILY_TOKENS = '10000000';
delete process.env.FALLBACK_API_URL;

const notified = [];

const requireSrc = install({
  [at('categoriesRepo.js')]: { listNames: async () => ['Другое'] },
  [at('telegram/notify.js')]: {
    ADMIN_IDS: new Set(['1']),
    isAllowed: () => true,
    notifyAdmins: async (text) => {
      notified.push(text);
    },
  },
});

const asked = [];
// Основной модели больше нет; запасная отвечает как обычно.
global.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  asked.push(body);
  // Заголовки с остатком минутного лимита — иначе бот держит между разборами
  // фиксированную паузу в 35 секунд и тест ушёл бы в таймаут (см. waitMs).
  const headers = {
    get: (name) =>
      ({ 'x-ratelimit-remaining-tokens': '8000', 'x-ratelimit-reset-tokens': '1s' })[name] ?? null,
  };

  if (body.model === 'qwen/qwen3.8-27b') {
    return {
      ok: false,
      status: 404,
      headers,
      json: async () => ({
        error: { code: 'model_not_found', message: 'The model `qwen/qwen3.8-27b` does not exist' },
      }),
    };
  }
  return {
    ok: true,
    status: 200,
    headers,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              listings: [
                { is_listing: true, listing_type: 'order', title: 'Сантехник', phone: '0700111222', city: 'Бишкек' },
              ],
            }),
          },
        },
      ],
      usage: { total_tokens: 4000 },
    }),
  };
};

const extract = requireSrc('telegram/extract.js');

test('пропавшая модель не роняет разбор — бот сам спускается по лесенке', async () => {
  const [listing] = await extract.fromText('нужен сантехник поменять кран 0700111222');
  assert.equal(listing.title, 'Сантехник', 'объявление всё-таки разобрано');
  assert.deepEqual(
    asked.map((b) => b.model),
    ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b'],
    'сначала основная, потом запасная'
  );
});

test('про смену модели админ узнаёт из чата, а не из логов Render', () => {
  assert.equal(notified.length, 1);
  assert.match(notified[0], /qwen\/qwen3\.8-27b/);
  assert.match(notified[0], /openai\/gpt-oss-120b/);
  assert.match(notified[0], /GROQ_MODELS/, 'сказано, где поменять модели руками');
});

test('второй разбор идёт сразу на запасную — про пропажу бот уже знает', async () => {
  asked.length = 0;
  await extract.fromText('нужен электрик 0700111333');
  assert.deepEqual(asked.map((b) => b.model), ['openai/gpt-oss-120b']);
  assert.equal(notified.length, 1, 'и повторно об этом не пишет');
});

test('gpt-oss не умеет выключать размышления — ему шлём минимум, а не «none»', () => {
  assert.equal(asked.at(-1).reasoning_effort, 'low', 'на «none» эта модель отвечает 400');
});

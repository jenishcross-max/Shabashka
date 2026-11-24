// Ролик Instagram, отложенный из-за суточной нормы, — не ошибка; а пачка, которой
// не хватило места под ролик, уходит каруселью картинок.
//
// В сводке 6–7 ноября 2026 стояло «Instagram: … · не вышло 25–27». По логам все
// эти «не вышло» — пачки по 2–3 объявления, которым не нашлось места в норме на
// ролики (40 из 40): одиночное объявление в этом случае уходит картинкой, а у
// пачки запасного хода нет (см. withImageFallback в src/social/index.js), и она
// ждёт автоповтора. Владелец видел «не вышло 25» и не мог понять, сломалось ли
// что-то. Теперь такой отказ помечен quota: true, и сводка считает его отдельно
// («отложено из-за нормы»), а «не вышло» остаётся для настоящих ошибок.
//
// А чтобы пачка не ждала часами, она уходит каруселью: по картинке на объявление,
// одной публикацией из запаса нормы — одиночное объявление и раньше уходило так
// одной картинкой.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');

process.env.RENDER_EXTERNAL_URL = 'https://shabashka.test';

const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...rest) => realSetTimeout(fn, ms >= 1000 ? 2 : ms, ...rest);
const settle = () => new Promise((r) => realSetTimeout(r, 60));

// Норма: свободных мест под ролики — rooms, под всё вместе — hard.
const room = { reels: 0, hard: 10 };
const quota = {
  sync: async () => null,
  adLimit: () => 100,
  hardLimit: () => 50,
  dailyLimit: () => 40,
  used: () => 40,
  left: (limit) => (limit === 40 ? room.reels : room.hard),
  take: (limit) => {
    const key = limit === 40 ? 'reels' : 'hard';
    if (room[key] <= 0) return false;
    room[key] -= 1;
    return true;
  },
  freeAt: () => null,
  RESERVE: 10,
};

let reelError = null;
const carousels = [];
const reels = [];
let trialOn = false;
let trialRejected = false;
const requireSrc = install({
  [at('social/quota.js')]: quota,
  [at('social/tokens.js')]: { get: () => 'токен', start: async () => {}, load: async () => {} },
  [at('social/adTracker.js')]: { start: () => {} },
  [at('social/leads.js')]: { start: () => {} },
  [at('social/threads.js')]: {
    isConfigured: () => true,
    isPermissionError: () => false,
    publishText: async () => 't1',
    publishImage: async () => 'i1',
    publishVideo: async () => 'v1',
    publishCarousel: async () => 'c1',
    publishingLimit: async () => ({ used: 0, total: 250 }),
  },
  [at('social/instagram.js')]: {
    isConfigured: () => true,
    publishReel: async (url, caption, cover, opts = {}) => {
      if (reelError) throw reelError;
      reels.push(opts);
      return 'reel';
    },
    trialRejected: () => trialRejected,
    publishImage: async () => 'ig-image',
    publishCarousel: async (urls, caption) => {
      carousels.push({ urls, caption });
      return 'ig-carousel';
    },
    publishingLimit: async () => ({ used: 40, total: 100 }),
    permalink: async () => '',
  },
  [at('social/card.js')]: {
    renderStill: async () => Buffer.from('jpeg'),
    stillName: () => 'card.jpg',
    collectionTitle: () => 'Вакансия дня',
    dayLabel: () => '8 ноября',
    isStudentBatch: () => false,
    COVER_AT: 3.6,
  },
  [at('social/trial.js')]: { next: () => trialOn },
  [at('social/video.js')]: {
    ...require('../src/social/video'),
    build: async () => ({ buffer: Buffer.from('mp4'), credit: null }),
  },
});

const social = requireSrc('social/index.js');
const done = [];
social.onReel(async (result) => done.push(result));

const job = (title, i) => [
  { title, description: 'Смена 12 часов', category: 'Общепит', city: 'Бишкек', budget: 1500, phone: `+99650016063${i}` },
  'vacancy',
  `шабашка.com/vacancies/${i}`,
  { chatId: 1 },
  {},
];

test('пачке не хватило места под ролик — уходит каруселью картинок, одной публикацией', async () => {
  done.length = 0;
  carousels.length = 0;
  room.reels = 0;
  room.hard = 10;
  await social.shareListing(...job('Продавец', 5));
  await social.shareListing(...job('Кассир', 6));
  assert.equal(social.flushNow('vacancy'), 2);
  await settle();
  const [result] = done;
  assert.ok(result && result.instagram, 'отчёт о ролике пришёл');
  assert.equal(result.instagram.posted, true);
  assert.equal(result.instagram.asImage, true, 'в сводке — «картинкой»');
  assert.equal(result.instagram.asCarousel, true, 'в отчёте — «каруселью картинок»');
  assert.match(result.instagram.videoReason, /норма на ролики выбрана/);
  assert.equal(carousels.length, 1);
  assert.equal(carousels[0].urls.length, 2, 'по картинке на объявление');
  assert.match(carousels[0].caption, /Продавец/);
  assert.match(carousels[0].caption, /Кассир/);
  assert.equal(room.hard, 9, 'карусель — одна публикация');
});

test('и под картинки места нет — отказ помечен quota, а не ошибкой', async () => {
  done.length = 0;
  room.reels = 0;
  room.hard = 0;
  await social.shareListing(...job('Бариста', 1));
  await social.shareListing(...job('Официант', 2));
  assert.equal(social.flushNow('vacancy'), 2);
  await settle();
  const [result] = done;
  assert.ok(result && result.instagram, 'отчёт о ролике пришёл');
  assert.equal(result.instagram.posted, false);
  assert.equal(result.instagram.quota, true);
  assert.match(result.instagram.reason, /норма на ролики выбрана/);
});

test('настоящая ошибка Instagram — без пометки quota', async () => {
  done.length = 0;
  room.reels = 5;
  room.hard = 10;
  // Мёртвый токен (код 190): картинкой или каруселью не пробуем — тот же аккаунт.
  reelError = Object.assign(new Error('Error validating access token'), { code: 190 });
  try {
    await social.shareListing(...job('Повар', 3));
    await social.shareListing(...job('Курьер', 4));
    assert.equal(social.flushNow('vacancy'), 2);
    await settle();
  } finally {
    reelError = null;
  }
  const [result] = done;
  assert.ok(result && result.instagram, 'отчёт о ролике пришёл');
  assert.equal(result.instagram.posted, false);
  assert.ok(!result.instagram.quota, 'это не норма');
  assert.match(result.instagram.reason, /access token/);
});

// Пробный ролик (см. src/social/trial.js): решение — одно на задание, и в отчёте
// видно, вышел ли ролик пробным на самом деле — Meta могла пометку не принять.
test('пробный ролик: пометка уходит в Instagram и видна в отчёте', async () => {
  done.length = 0;
  reels.length = 0;
  room.reels = 5;
  room.hard = 10;
  trialOn = true;
  try {
    await social.shareListing(...job('Грузчик', 7));
    await social.shareListing(...job('Упаковщик', 8));
    assert.equal(social.flushNow('vacancy'), 2);
    await settle();
    assert.deepEqual(reels, [{ trial: true }]);
    assert.equal(done[0].instagram.trial, true);

    done.length = 0;
    trialRejected = true;
    await social.shareListing(...job('Сборщик', 9));
    await social.shareListing(...job('Курьер', 10));
    social.flushNow('vacancy');
    await settle();
    assert.equal(done[0].instagram.trial, false, 'Meta не приняла — ролик вышел обычным');
  } finally {
    trialOn = false;
    trialRejected = false;
  }
});

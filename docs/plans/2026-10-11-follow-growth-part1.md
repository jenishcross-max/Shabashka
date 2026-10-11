# Подписчики, часть 1: замер и строка «подпишись» — план реализации

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** Видеть в сводке, сколько подписчиков у Threads, Instagram и Telegram-канала
и сколько прибавилось за сутки, и звать подписаться в самих постах.

**Architecture:** Новый модуль `social/follow.js` без зависимостей выдаёт строку
«подпишись» (каждому N-му посту Threads и каждому ролику Instagram, кроме рекламы);
число объявлений за сутки ему раз в час передаёт бот. Под постами канала — кнопка
«🔔 Подписаться на канал». Сводка (`telegram/summary.js`) спрашивает подписчиков у
площадок и Telegram, пишет снимок дня в `app_settings` и показывает прирост от
вчерашнего.

**Tech Stack:** Node.js, `node:test`, Postgres (`app_settings`, `imported_listings`),
Threads/Instagram Graph API, Telegram Bot API.

**Ограничения проекта:**
- Бэкенд локально НЕ запускать (в `backend/.env` боевая база). Только `npm test`.
- Файлы в CRLF; комментарии по-русски, в стиле соседнего кода.
- Коммит и пуш — только после «комит пуш» от владельца, одним коммитом в конце.
- Запуск тестов: `cd backend && node --test test/<файл>.test.js`, всё — `npm test`.

---

### Task 1: Подписчики Threads и Instagram одним вызовом

**Files:**
- Modify: `backend/src/social/threads.js` — `accountInsights` (≈242–267), экспорт
- Modify: `backend/src/social/index.js` — новая `followers()`, экспорт

**Step 1:** В `threads.js` вынести запрос подписчиков из `accountInsights` в свою функцию:

```js
// Подписчики на сейчас. За период Meta их не отдаёт — только число на сейчас,
// отдельным запросом без дат.
async function followers() {
  const { data } = await safeCall('подписчики Threads', 'GET', `${USER_ID}/threads_insights`, {
    metric: 'followers_count',
  });
  return metric(data, 'followers_count');
}
```

В `accountInsights` вместо прежнего `try` с `safeCall`:

```js
  let count = null;
  try {
    count = await followers();
  } catch (err) {
    console.log(`[threads] подписчиков не узнать (${err.message})`);
  }
```

и `followers: count` в ответе. Добавить `followers` в `module.exports`.

**Step 2:** В `social/index.js` рядом с `limits()`:

```js
// Подписчики на сейчас — для сводки (см. telegram/summary.js). Площадка, которая
// не настроена или не ответила, отдаёт null: сводка обойдётся без её числа.
async function followers() {
  const ask = (platform) => (platform.isConfigured() ? platform.followers().catch(() => null) : null);
  const [th, ig] = await Promise.all([ask(threads), ask(instagram)]);
  return { threads: th, instagram: ig };
}
```

Экспорт: `followers,`.

**Step 3:** `npm test` — всё зелёное (поведение `accountInsights` не изменилось).

---

### Task 2: Строка подписчиков в сводке

**Files:**
- Modify: `backend/src/telegram/summary.js`
- Test: `backend/test/summary.test.js`

**Step 1: Тест (падает).** В `summary.test.js`:
- до `install`: `process.env.TELEGRAM_CHANNEL_ID = '@shabashka';`
- в заглушку `social/index.js`: `followers: async () => ({ threads: 1240, instagram: 830 }),`
- после `const tg = chat();`:
  `tg.api.call = async (method) => (method === 'getChatMemberCount' ? 410 : { ok: true });`

```js
test('подписчики площадок — с приростом от вчерашнего снимка', async () => {
  settings.set('followers:2026-10-02', JSON.stringify({ threads: 1228, instagram: 831, channel: 405 }));
  const { text } = await summary.build({ now: at1310 });
  assert.match(text, /👥 Подписчики: Threads 1\s240 \(\+12\) · Instagram 830 \(−1\) · канал 410 \(\+5\)/);
  assert.deepEqual(JSON.parse(settings.get('followers:2026-10-03')), { threads: 1240, instagram: 830, channel: 410 });
});
```

(`at1310` объявить выше этого теста или перенести тест ниже его объявления.)

Run: `node --test test/summary.test.js` → FAIL: нет строки «Подписчики».

**Step 2: Реализация** в `summary.js`:

```js
const DAY_MS = 24 * HOUR_MS;

// Подписчики площадок и прирост за сутки: по ним видно, работает ли зов
// подписаться (см. social/follow.js). Снимок дня пишем в базу при первой
// сводке дня, прирост считаем от вчерашнего. Площадку, которая не ответила,
// просто не называем.
const FOLLOWERS = 'followers:';
const PLACES = [
  ['threads', 'Threads'],
  ['instagram', 'Instagram'],
  ['channel', 'канал'],
];

async function readJson(key) {
  try {
    return JSON.parse((await feedStats.getSetting(key)) || 'null');
  } catch {
    return null;
  }
}

async function counts() {
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  const [platforms, channel] = await Promise.all([
    (async () => social.followers())().catch(() => ({})),
    channelId ? tg.call('getChatMemberCount', { chat_id: channelId }).catch(() => null) : null,
  ]);
  return { threads: platforms.threads, instagram: platforms.instagram, channel };
}

async function followerLines(now) {
  const current = await counts();
  const known = PLACES.filter(([key]) => Number.isFinite(current[key]));
  if (!known.length) return [];

  const todayKey = `${FOLLOWERS}${feedStats.today(now)}`;
  const [stored, yesterday] = await Promise.all([
    readJson(todayKey),
    readJson(`${FOLLOWERS}${feedStats.today(now - DAY_MS)}`),
  ]);
  if (!stored) {
    await feedStats
      .setSetting(todayKey, JSON.stringify(current))
      .catch((err) => console.error('[сводка] снимок подписчиков не записать:', err.message));
  }
  const delta = (key) => {
    const before = yesterday && yesterday[key];
    if (!Number.isFinite(before)) return '';
    const d = current[key] - before;
    return ` (${d < 0 ? '−' : '+'}${num(Math.abs(d))})`;
  };
  return [`👥 Подписчики: ${known.map(([key, label]) => `${label} ${num(current[key])}${delta(key)}`).join(' · ')}`];
}
```

В `build()` сразу после блока «📲 Площадки»: `lines.push(...(await followerLines(now)));`

**Step 3:** `node --test test/summary.test.js` → PASS. `npm test` → всё зелёное.

---

### Task 3: Модуль строки «подпишись»

**Files:**
- Create: `backend/src/social/follow.js`
- Test: `backend/test/follow.test.js`

**Step 1: Тест (падает):**

```js
// Строка «подпишись» в постах (см. src/social/follow.js).
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.FOLLOW_EVERY;
const follow = require('../src/social/follow');

test('строка — у каждого четвёртого поста, а варианты чередуются', () => {
  const got = Array.from({ length: 8 }, () => follow.next());
  assert.deepEqual(got.map(Boolean), [false, false, false, true, false, false, false, true]);
  assert.notEqual(got[3], got[7]);
});

test('число за сутки — круглое и с плюсом, маленькое не называем', () => {
  follow.setDaily(67);
  assert.match(follow.line(), /60\+/);
  follow.setDaily(12);
  assert.doesNotMatch(follow.line(), /\d/);
  follow.setDaily(null);
  assert.match(follow.line(), /^🔔 Подпишись/);
});

test('FOLLOW_EVERY: off и 0 выключают, мусор — по умолчанию', () => {
  assert.equal(follow.parseEvery('off'), 0);
  assert.equal(follow.parseEvery('0'), 0);
  assert.equal(follow.parseEvery('10'), 10);
  assert.equal(follow.parseEvery('abc'), 4);
  assert.equal(follow.parseEvery(undefined), 4);
});
```

Run: `node --test test/follow.test.js` → FAIL: Cannot find module.

**Step 2: Реализация** `backend/src/social/follow.js`:

```js
// Строка «подпишись» в постах. Посты-объявления набирают просмотры, а
// подписчиков почти не дают: человек нашёл работу, позвонил и ушёл — ни один
// пост не звал его остаться. Теперь зовёт: каждый EVERY-й пост Threads и
// подпись каждого ролика. Не каждый пост Threads — иначе лента станет рекламой
// самой себя. Рекламе строки нет: рекламодатель платит за свой пост (см.
// shareListing и runBatch в index.js, кнопку канала в telegram/bot.js).
//
// Число в строке — сколько объявлений вышло за сутки: проверяемое «60+»
// убеждает лучше «много вакансий». Считает его бот раз в час (setDaily), так
// что базы этому модулю не нужно.

// FOLLOW_EVERY — раз в сколько постов Threads; off или 0 — строки нет нигде.
function parseEvery(value) {
  const raw = String(value ?? '4').trim();
  if (/^(off|no|нет|-|0)$/i.test(raw)) return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 4;
}
const EVERY = parseEvery(process.env.FOLLOW_EVERY);

// Меньше двадцати за сутки — число не называем: «10+ в день» скорее отпугнёт.
const MIN_COUNT = 20;

const WITH_COUNT = (n) => [
  `🔔 Подпишись — каждый день ${n} новых вакансий и подработок`,
  `🔔 Подпишись, чтобы не пропустить работу: ${n} новых объявлений в день`,
  `🔔 Подпишись — ${n} свежих объявлений о работе каждый день`,
];
const PLAIN = ['🔔 Подпишись — новые вакансии и подработки каждый день', '🔔 Подпишись, чтобы не пропустить свежую работу'];

let daily = null;
let posts = 0;
let turn = 0;

function setDaily(n) {
  daily = n === null || n === undefined || !Number.isFinite(Number(n)) ? null : Number(n);
}

// Строка по кругу из вариантов: одна и та же под каждым роликом примелькалась бы.
function line() {
  if (!EVERY) return '';
  const lines = daily >= MIN_COUNT ? WITH_COUNT(`${Math.floor(daily / 10) * 10}+`) : PLAIN;
  turn += 1;
  return lines[turn % lines.length];
}

// Для потока постов Threads: строка у каждого EVERY-го.
function next() {
  if (!EVERY) return '';
  posts += 1;
  return posts % EVERY === 0 ? line() : '';
}

module.exports = { line, next, setDaily, parseEvery, EVERY };
```

**Step 3:** `node --test test/follow.test.js` → PASS.

---

### Task 4: Строка в постах Threads

**Files:**
- Modify: `backend/src/social/video.js` — `threadsText` (≈300–333)
- Modify: `backend/src/social/index.js` — `shareListing` (≈843–858), `require('./follow')`
- Test: `backend/test/social-threads.test.js`

**Step 1: Тест (падает):**

```js
test('каждый четвёртый пост-объявление зовёт подписаться, реклама — никогда', async () => {
  posted.length = 0;
  for (const n of [21, 22, 23, 24]) social.shareListing(parsed, 'vacancy', `шабашка.com/vacancies/${n}`, { chatId: 1 }, {});
  social.shareListing(parsed, 'vacancy', 'шабашка.com/vacancies/25', { chatId: 1 }, { priority: true });
  await settle();
  const ordinary = posted.filter((p) => !/vacancies\/25/.test(p.text));
  const withFollow = ordinary.filter((p) => p.text.includes('🔔 Подпишись'));
  assert.equal(withFollow.length, 1, 'ровно один из четырёх');
  assert.match(withFollow[0].text, /🔔 Подпишись[^\n]*\nшабашка\.com\/vacancies\/\d+$/, 'строка — прямо перед ссылкой');
  assert.ok(!posted.find((p) => /vacancies\/25/.test(p.text)).text.includes('🔔'), 'у рекламы строки нет');

  const long = video.threadsText({ ...parsed, description: 'Очень длинное описание. '.repeat(60) }, 'vacancy', 'шабашка.com/vacancies/9', {
    follow: '🔔 Подпишись — каждый день 60+ новых вакансий и подработок',
  });
  assert.ok(video.weight(long) <= 500, `вес ${video.weight(long)}`);
});
```

(`const video = requireSrc('social/video.js');` вверху, если его там нет.)

Run → FAIL: строки нет.

**Step 2:** `video.js`, `threadsText`: опция `follow = ''`; в хвост — перед ссылкой:

```js
function threadsText(parsed, listingType, siteLink, { ad = false, follow = '' } = {}) {
  ...
  // Хвост собираем раньше описания: ссылка обязательна, а описание ужимается
  // под остаток. Зов подписаться — прямо перед ссылкой (см. follow.js).
  const tail = [];
  if (follow) tail.push(follow);
  if (siteLink) tail.push(siteLink);
```

**Step 3:** `index.js`: `const follow = require('./follow');` вверху; в `shareListing`:

```js
    const text = video.threadsText(parsed, listingType, siteLink, {
      ad: priority,
      follow: priority ? '' : follow.next(),
    });
```

**Step 4:** `node --test test/social-threads.test.js` → PASS; `npm test`.

---

### Task 5: Строка в подписи роликов Instagram

**Files:**
- Modify: `backend/src/social/video.js` — `caption` (≈255–281)
- Modify: `backend/src/social/index.js` — `runBatch` (≈480–499)
- Test: `backend/test/caption.test.js`

**Step 1: Тест (падает):**

```js
test('зов подписаться — следом за зовом на сайт, и только когда его дали', () => {
  const text = video.caption([item], null, { follow: '🔔 Подпишись — каждый день 60+ новых вакансий и подработок' });
  assert.match(text, /Шабашка\.com, ссылка в шапке профиля\.\n🔔 Подпишись — каждый день 60\+/);
  assert.doesNotMatch(video.caption([item], null, {}), /🔔/);
});
```

**Step 2:** `caption`: после строки CTA:

```js
  // Зов подписаться — следом за зовом на сайт (см. follow.js); у рекламы его нет.
  if (opts.follow) lines.push(opts.follow);
```

**Step 3:** `runBatch`: после объявления `job`:

```js
  // Зов подписаться — в подписи каждого ролика, кроме рекламного (см. follow.js).
  // В задании, а не при сборке подписи: повтор выйдет с той же строкой.
  job.follow = job.ad ? '' : follow.line();
```

**Step 4:** `node --test test/caption.test.js test/social-threads.test.js` → PASS.

---

### Task 6: Кнопка под постами канала и число за сутки

**Files:**
- Modify: `backend/src/telegram/imports.js` — `countPublishedSince`, экспорт
- Modify: `backend/src/telegram/bot.js` — `CHANNEL_URL` (≈36), `publishOne` (≈724–732), `startWatchers` (≈2647)
- Test: `backend/test/bot-quiet.test.js`

**Step 1: Тест (падает)** — в первом тесте `bot-quiet.test.js` после `toChannel().length`:

```js
  const [button] = toChannel()[0].extra.reply_markup.inline_keyboard.flat();
  assert.equal(button.url, 'https://t.me/shabashka', 'под постом канала — «Подписаться»');
```

**Step 2:** `imports.js`:

```js
// Сколько объявлений вышло за последние часы — для строки «подпишись»
// (см. social/follow.js). Тот же частичный индекс, что у списка опубликованного.
async function countPublishedSince(hours = 24) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM imported_listings
      WHERE status = 'published' AND published_at > NOW() - make_interval(hours => $1)`,
    [hours]
  );
  return rows[0].n;
}
```

**Step 3:** `bot.js`:
- `const follow = require('../social/follow');`
- под `CHANNEL_ID`:

```js
// Кнопка «Подписаться» под постами канала: пересланный пост видят и те, кто на
// канал не подписан. У публичного канала (@имя) ссылка собирается сама; для
// числового id — TELEGRAM_CHANNEL_URL, иначе тот же канал, что на сайте.
const CHANNEL_URL =
  process.env.TELEGRAM_CHANNEL_URL ||
  (CHANNEL_ID.startsWith('@') ? `https://t.me/${CHANNEL_ID.slice(1)}` : 'https://t.me/Shabashkacom');
```

- в `publishOne`:

```js
      // У рекламы кнопки нет: рекламодатель платит за свой пост (см. follow.js).
      const subscribe =
        !priority && follow.EVERY
          ? { reply_markup: { inline_keyboard: [[{ text: '🔔 Подписаться на канал', url: CHANNEL_URL }]] } }
          : undefined;
      const inChannel = await tg.sendMessage(CHANNEL_ID, `${tg.esc(body)}${linkTag}`, subscribe);
```

- в `startWatchers`:

```js
  // Число объявлений за сутки для строки «подпишись» (см. social/follow.js).
  const countDaily = () =>
    imports
      .countPublishedSince(24)
      .then(follow.setDaily)
      .catch((err) => console.error('[подписка] число за сутки:', err.message));
  countDaily();
  setInterval(countDaily, 60 * 60 * 1000).unref();
```

**Step 4:** `node --test test/bot-quiet.test.js` → PASS; `npm test`.

---

### Task 7: README и проверка

- README: абзац про строку «подписаться» и строку подписчиков в сводке; в таблицу
  переменных — `FOLLOW_EVERY` (по умолчанию 4, `off` — выключить) и
  `TELEGRAM_CHANNEL_URL`.
- Нормализовать CRLF, `npm test` целиком.
- Показать диф владельцу; коммит и пуш — по «комит пуш».

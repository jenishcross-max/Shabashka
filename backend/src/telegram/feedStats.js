const db = require('../db');

// Счётчики событий за день — для сводки (см. summary.js).
//
// Раньше на каждый пост из группы бот присылал в чат по пять сообщений:
// карточку, «в очереди Threads», «Threads — опубликовано», «Instagram —
// опубликовано» и /stats. Из групп их выходит под сотню в день, и среди этого
// потока терялось то, что требует решения: оплата рекламы, отказ площадки,
// просьба позвать человека. Теперь посты из групп публикуются молча, а сюда
// пишется, что с ними стало, — и раз в несколько часов приходит одна сводка.
//
// В базе, а не в памяти: бесплатный Render перезапускается и засыпает, и
// счётчик в памяти к вечерней сводке показывал бы «с обеда».

// День — по Бишкеку: Render живёт в UTC, и после полуночи по местному времени
// счётчики ещё шесть часов писались бы во вчера.
function today(now = Date.now()) {
  return new Date(now + 6 * 3600 * 1000).toISOString().slice(0, 10);
}

// Прибавить к счётчику. Ошибку глотаем: сводка — не то, ради чего стоит
// ронять публикацию.
async function bump(key, n = 1) {
  if (!n) return;
  try {
    await db.query(
      `INSERT INTO bot_counters (day, key, n) VALUES ($1, $2, $3)
       ON CONFLICT (day, key) DO UPDATE SET n = bot_counters.n + EXCLUDED.n`,
      [today(), key, n]
    );
  } catch (err) {
    console.error(`[сводка] счётчик ${key} не записан:`, err.message);
  }
}

// Все счётчики за день: { 'grp.ok.vacancy': 12, ... }.
async function day(date = today()) {
  const { rows } = await db.query('SELECT key, n FROM bot_counters WHERE day = $1', [date]);
  return Object.fromEntries(rows.map((row) => [row.key, Number(row.n) || 0]));
}

// Почему модель не взяла объявление — по её же пометке (см. note в extract.js).
// Корзины крупные: в сводке нужна картина, а не перечень формулировок.
function reasonOf(listing) {
  if (listing.spam) return listing.spam;
  const note = String(listing.note || '').toLowerCase();
  if (/сетев|должност|професси/.test(note)) return 'mlm';
  if (/чужи\S* документ|доверенност|подставн/.test(note)) return 'drop';
  if (/вербовк/.test(note)) return 'recruit';
  if (listing.abroad || /за\s*границ|за\s*рубеж/.test(note)) return 'abroad';
  return 'other';
}

// Последняя ошибка публикации из групп — показываем в сводке рядом с числом:
// одно «не вышло: 3» не говорит, что чинить.
let lastError = null;
function fail(message) {
  lastError = { message: String(message || ''), at: Date.now() };
  return bump('grp.fail');
}
const lastFailure = () => lastError;

// Маленькие настройки, которые бот меняет сам (когда была последняя сводка).
async function getSetting(key) {
  const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : null;
}

async function setSetting(key, value) {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, String(value)]
  );
}

module.exports = { bump, day, today, reasonOf, fail, lastFailure, getSetting, setSetting };

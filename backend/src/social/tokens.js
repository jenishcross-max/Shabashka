const crypto = require('crypto');
const db = require('../db');

// Токены Meta живут шестьдесят дней. Долгоживущий токен Threads и токен
// Instagram (Instagram Login) продлеваются одним запросом, но только пока они
// живы: истёкший уже не продлить, его придётся получать заново руками, через
// кабинет разработчика. А без токена Threads встаёт весь рекламный канал —
// рекламу у Шабашки заказывают именно там, — и встаёт молча: бот пишет
// «не вышло», а причина видна только в логах Render.
//
// Поэтому токен продлевается сам, раз в неделю, задолго до конца срока.
// Продлённый токен хранится в базе: переменную окружения на Render изнутри
// приложения не поменять, а держать его в памяти — значит потерять при первом
// же перезапуске и вернуться к старому, у которого срок идёт.
//
// Откуда токен взялся, помним по отпечатку исходного токена из переменной
// окружения. Если админ вписал в Render новый — отпечаток не совпадёт, и бот
// начнёт с нового, а не будет упрямо продлевать прежний, записанный в базе.

// Где продлевать. У Threads и Instagram Login схема одна и та же, отличаются
// только адрес и grant_type. Токен Facebook Login так не продлевается — для
// него в этом модуле ничего не делаем (см. canRefresh).
const PLATFORMS = {
  threads: {
    env: 'THREADS_ACCESS_TOKEN',
    refreshUrl: 'https://graph.threads.net/refresh_access_token',
    grant: 'th_refresh_token',
  },
  instagram: {
    env: 'INSTAGRAM_ACCESS_TOKEN',
    refreshUrl: 'https://graph.instagram.com/refresh_access_token',
    grant: 'ig_refresh_token',
  },
};

// Раз в неделю: с запасом до шестидесяти дней, и даже если несколько попыток
// подряд сорвутся, времени поправить руками останется вдоволь. Чаще нет смысла —
// Meta и так продлевает срок на полные шестьдесят дней от момента продления.
const REFRESH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// platform → { token, seed, refreshedAt, expiresAt }. seed — отпечаток токена
// из окружения, от которого пошла эта цепочка продлений.
const current = new Map();

const fingerprint = (token) => crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);

function envToken(platform) {
  return process.env[PLATFORMS[platform].env] || '';
}

// Токен, которым сейчас ходить в API. Пока из базы ничего не прочитано (или
// читать нечего) — тот, что в переменной окружения.
function get(platform) {
  const stored = current.get(platform);
  return stored ? stored.token : envToken(platform);
}

function canRefresh(platform) {
  // Instagram через Facebook Login продлевается иначе (fb_exchange_token и
  // ключ приложения) — трогать его здесь нельзя.
  if (platform === 'instagram' && /facebook/i.test(process.env.INSTAGRAM_GRAPH_HOST || '')) return false;
  return Boolean(envToken(platform));
}

const settingKey = (platform) => `token:${platform}`;

// Подтянуть продлённые токены из базы. Зовётся один раз при старте; ошибку не
// бросает — без базы работаем на токенах из окружения, как раньше.
async function load() {
  for (const platform of Object.keys(PLATFORMS)) {
    const env = envToken(platform);
    if (!env) continue;
    try {
      const { rows } = await db.query('SELECT value FROM app_settings WHERE key = $1', [settingKey(platform)]);
      if (!rows[0]) continue;
      const saved = JSON.parse(rows[0].value);
      // В Render вписали другой токен — начинаем с него, старую цепочку забываем.
      if (saved.seed !== fingerprint(env)) {
        console.log(`[токены] ${platform}: в окружении новый токен — беру его, а не продлённый из базы`);
        continue;
      }
      if (saved.expiresAt && saved.expiresAt <= Date.now()) continue;
      current.set(platform, saved);
    } catch (err) {
      console.error(`[токены] ${platform}: не прочитать из базы (${err.message})`);
    }
  }
}

async function save(platform, record) {
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [settingKey(platform), JSON.stringify(record)]
  );
}

// Когда токен продлевали в последний раз. Для токена прямо из окружения это
// неизвестно — считаем, что давно: первое же продление и заведёт цепочку.
function lastRefresh(platform) {
  const stored = current.get(platform);
  return stored ? stored.refreshedAt : 0;
}

// Продлить токен одной площадки. Возвращает { refreshed, expiresAt } или
// бросает ошибку с текстом Meta. Токен моложе суток Meta продлевать не даёт —
// такую ошибку помечаем tooYoung: это не поломка, а «рано».
async function refresh(platform, { force = false } = {}) {
  if (!canRefresh(platform)) return { refreshed: false, reason: 'не настроен' };
  if (!force && Date.now() - lastRefresh(platform) < REFRESH_EVERY_MS) {
    return { refreshed: false, reason: 'рано' };
  }

  const { refreshUrl, grant } = PLATFORMS[platform];
  const url = `${refreshUrl}?${new URLSearchParams({ grant_type: grant, access_token: get(platform) })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30 * 1000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const e = data.error || {};
    const err = new Error(e.message || `ответ ${res.status}`);
    err.code = e.code;
    if (/at least 24 hours|too recent|less than 24 hours/i.test(err.message)) err.tooYoung = true;
    throw err;
  }

  const record = {
    token: data.access_token,
    seed: fingerprint(envToken(platform)),
    refreshedAt: Date.now(),
    expiresAt: Date.now() + (Number(data.expires_in) || 60 * 24 * 3600) * 1000,
  };
  current.set(platform, record);
  await save(platform, record);
  // Сам токен в лог не пишем никогда — только срок.
  console.log(`[токены] ${platform}: продлён до ${new Date(record.expiresAt).toISOString().slice(0, 10)}`);
  return { refreshed: true, expiresAt: record.expiresAt };
}

// Сколько дней осталось, если это известно.
function daysLeft(platform) {
  const stored = current.get(platform);
  if (!stored || !stored.expiresAt) return null;
  return Math.floor((stored.expiresAt - Date.now()) / DAY_MS);
}

// Раз в сутки проверяем, не пора ли продлить. Провал — сразу в чат админу, но
// не чаще раза в сутки на площадку: пока срок не вышел, время есть, а молчать
// нельзя — через шестьдесят дней после последнего продления канал встанет.
const CHECK_EVERY_MS = DAY_MS;
let timer = null;

async function tick(notify) {
  for (const platform of Object.keys(PLATFORMS)) {
    try {
      await refresh(platform);
    } catch (err) {
      if (err.tooYoung) continue;
      const left = daysLeft(platform);
      console.error(`[токены] ${platform}: не продлить (${err.message})`);
      await notify(
        [
          `🔑 Токен ${platform === 'threads' ? 'Threads' : 'Instagram'} не продлился: ${err.message}`,
          left !== null ? `Осталось дней: ${left}.` : 'Сколько ему осталось, не знаю — он из переменной окружения.',
          'Если ошибка повторится, получите новый токен в кабинете разработчика Meta и впишите его в Render.',
        ].join('\n')
      ).catch(() => {});
    }
  }
}

async function start(notify) {
  await load();
  if (timer) return;
  // Первая проверка — через минуту после старта, а не сразу: Render после
  // выката перезапускает сервис несколько раз подряд, и продлевать на каждом
  // таком запуске незачем.
  setTimeout(() => tick(notify), 60 * 1000).unref();
  timer = setInterval(() => tick(notify), CHECK_EVERY_MS);
  timer.unref();
}

module.exports = { get, load, refresh, start, daysLeft, lastRefresh, fingerprint, REFRESH_EVERY_MS };

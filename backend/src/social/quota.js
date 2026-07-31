// Instagram считает публикации по аккаунту-получателю, а не по приложению:
// 25 попыток создать пост за скользящие сутки, причём в счёт идут и неудачные.
// Свой потолок держим ниже настоящего — остаток нужен на публикации руками из
// самого приложения и на повторы, которые иначе упирались бы в стену.
const DAILY_LIMIT = 22;
const WINDOW_MS = 24 * 60 * 60 * 1000;

// Счётчик живёт в памяти процесса, своей таблицы под него не заводили. На
// бесплатном Render процесс засыпает и просыпается с нуля, так что после
// перезапуска счётчик занижен — это осознанное ограничение: он страхует от
// того, чтобы выжечь квоту пачкой за несколько минут, но гарантией не служит.
// Настоящий потолок ловится по подкоду 2207042 (см. isHardLimit в net.js).
const attempts = [];

function sweep(now) {
  while (attempts.length && now - attempts[0] >= WINDOW_MS) attempts.shift();
}

function used() {
  sweep(Date.now());
  return attempts.length;
}

function left() {
  return Math.max(0, DAILY_LIMIT - used());
}

// Отмечаем попытку, а не успех: Instagram списывает единицу квоты за каждый
// созданный контейнер, даже если публикация потом не прошла. Возвращает false,
// если места в сутках уже нет — тогда к Meta лучше не ходить вовсе.
function take() {
  const now = Date.now();
  sweep(now);
  if (attempts.length >= DAILY_LIMIT) return false;
  attempts.push(now);
  return true;
}

// Когда освободится место, если сейчас его нет: самая старая попытка выпадает
// из окна ровно через сутки после себя.
function freeAt() {
  sweep(Date.now());
  return attempts.length >= DAILY_LIMIT ? new Date(attempts[0] + WINDOW_MS) : null;
}

module.exports = { take, used, left, freeAt, DAILY_LIMIT };

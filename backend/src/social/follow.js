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

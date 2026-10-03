// Мелочи оформления для сообщений бота: числа, время, обрезка. Общие для
// сводки, меню и отчётов — раньше у каждого была своя копия.

// Числа по-русски: «1 842», а не «1842». Пробел — неразрывный, как и положено
// разделителю разрядов, так что в узком чате число не разорвётся.
const num = (n) => Number(n || 0).toLocaleString('ru-RU');

// Склонение после числа: plural(3, ['пост', 'поста', 'постов']) → «поста».
function plural(n, [one, few, many]) {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

const viewsWord = (n) => plural(n, ['просмотр', 'просмотра', 'просмотров']);

// Обрезаем длинное: в сообщение Telegram влезает 4096 символов, и один
// разговорчивый заказ не должен ронять всю карточку ошибкой 400. Режем до
// экранирования — иначе можно разрубить пополам «&amp;» и получить битый HTML.
function clamp(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

// «14:05» по Бишкеку — Render живёт по UTC, и без часового пояса срок уезжал
// бы на шесть часов назад.
function clock(ms) {
  return new Date(ms).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit' });
}

// «25 сентября, 14:05» по Бишкеку.
function whenText(at) {
  return new Date(at).toLocaleString('ru-RU', {
    timeZone: 'Asia/Bishkek',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function agoText(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} ч назад` : `${Math.round(hours / 24)} дн назад`;
}

module.exports = { num, plural, viewsWord, clamp, clock, whenText, agoText };

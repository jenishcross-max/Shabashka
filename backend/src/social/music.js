const fs = require('fs');
const path = require('path');

// Музыку из библиотеки Instagram («тренды», оригинальные звуки) через API
// подложить нельзя: аудиодорожку выбирают только вручную в приложении, а
// опубликованный по API ролик уходит со своим звуком и уже не редактируется.
// Поэтому свою фонотеку держим здесь и берём из неё случайный трек — ролики
// подряд не звучат одинаково.
const DIR = path.join(__dirname, '..', '..', 'assets', 'music');
const EXTENSIONS = /\.(mp3|m4a|aac|ogg|wav)$/i;
const LICENSE = 'CC BY 4.0 — creativecommons.org/licenses/by/4.0';

let credits;

function loadCredits() {
  if (credits) return credits;
  try {
    credits = JSON.parse(fs.readFileSync(path.join(DIR, 'credits.json'), 'utf8'));
  } catch {
    credits = {};
  }
  return credits;
}

// Возвращает { file, credit } либо null, если фонотека пуста.
//
// credit — не украшение: треки под Creative Commons требуют называть автора, и
// без этой строки в описании поста ролик можно снять по жалобе. Файл без записи
// в credits.json считаем несвободным и просто не берём — молчаливый ролик
// дешевле разбирательства с Instagram.
function pick() {
  let files;
  try {
    files = fs.readdirSync(DIR).filter((name) => EXTENSIONS.test(name));
  } catch {
    return null; // папки нет — ролик уйдёт с тишиной, это не повод падать
  }

  const known = loadCredits();
  const usable = files.filter((name) => known[name]);
  if (!usable.length) return null;

  const name = usable[Math.floor(Math.random() * usable.length)];
  const { title, author, source } = known[name];

  return {
    file: path.join(DIR, name),
    // «фрагмент» — обязательная по лицензии отметка о том, что трек изменён:
    // в ролик уходит обрезанный и выровненный по громкости кусок, не оригинал.
    credit: `♪ ${title} — ${author} (${source}), фрагмент\nЛицензия ${LICENSE}`,
  };
}

module.exports = { pick };

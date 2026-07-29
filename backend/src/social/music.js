const fs = require('fs');
const path = require('path');

// Музыку из библиотеки Instagram («тренды», оригинальные звуки) через API
// подложить нельзя: аудиодорожку выбирают только вручную в приложении, а
// опубликованный по API ролик уходит со своим звуком и уже не редактируется.
// Поэтому свою фонотеку держим здесь и берём из неё случайный трек — ролики
// подряд не звучат одинаково.
const DIR = path.join(__dirname, '..', '..', 'assets', 'music');
const EXTENSIONS = /\.(mp3|m4a|aac|ogg|wav)$/i;

function pick() {
  let files;
  try {
    files = fs.readdirSync(DIR).filter((name) => EXTENSIONS.test(name));
  } catch {
    return null; // папки нет — ролик уйдёт с тишиной, это не повод падать
  }
  if (!files.length) return null;
  return path.join(DIR, files[Math.floor(Math.random() * files.length)]);
}

module.exports = { pick };

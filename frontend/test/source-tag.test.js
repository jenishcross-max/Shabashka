// Метка источника из постов бота (см. backend/src/sourceTag.js): «?s=t» в
// адресе сайт превращает в utm_source до запуска Метрики — иначе заходы из
// Telegram и Threads она пишет в «прямые».
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const SCRIPT = INDEX.match(/<script id="source-tag">([\s\S]*?)<\/script>/)?.[1];
const { CODES } = createRequire(import.meta.url)('../../backend/src/sourceTag.js');

// Прогон скрипта на поддельном адресе: куда он переписал адрес и переписал ли.
function run(href) {
  const replaced = [];
  vm.runInNewContext(SCRIPT, {
    URL,
    location: { href },
    history: { state: null, replaceState: (_state, _title, url) => replaced.push(url) },
  });
  return replaced;
}

test('скрипт стоит до Метрики', () => {
  assert.ok(SCRIPT, 'скрипт метки есть в index.html');
  assert.ok(INDEX.indexOf('id="source-tag"') < INDEX.indexOf('YM_ID'), 'адрес переписан до init Метрики');
});

test('?s=t → utm_source=threads, сам s из адреса уходит', () => {
  assert.deepEqual(run('https://xn--80aaac0cyed.com/vacancies/12?s=t'), [
    '/vacancies/12?utm_source=threads&utm_medium=social',
  ]);
});

test('свои параметры и якорь остаются', () => {
  assert.deepEqual(run('https://xn--80aaac0cyed.com/vacancies?category=%D0%9E&s=tg#top'), [
    '/vacancies?category=%D0%9E&utm_source=telegram&utm_medium=social#top',
  ]);
});

test('без метки или с чужой — адрес не трогаем', () => {
  assert.deepEqual(run('https://xn--80aaac0cyed.com/vacancies/12'), []);
  assert.deepEqual(run('https://xn--80aaac0cyed.com/vacancies/12?s=zz'), []);
});

test('коды — те же, что ставит бот', () => {
  for (const [source, code] of Object.entries(CODES)) {
    assert.deepEqual(run(`https://xn--80aaac0cyed.com/?s=${code}`), [`/?utm_source=${source}&utm_medium=social`]);
  }
});

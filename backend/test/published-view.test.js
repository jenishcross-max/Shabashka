// «📥 Из групп» (/last): всё опубликованное, по десять на страницу, с вкладками
// «Из групп», «Мои» и «Всё» (см. publishedView в src/telegram/menu.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at, chat } = require('./helpers/stub');

const requireSrc = install({ [at('telegram/api.js')]: chat().api });
const menu = requireSrc('telegram/menu.js');

const NOW = Date.parse('2026-10-08T12:00:00Z');
const HOUR = 60 * 60 * 1000;

const row = (n, extra = {}) => ({
  id: n,
  parsed: { title: `Объявление ${n}`, phone: `+99670000${String(n).padStart(4, '0')}` },
  source: 'channel',
  is_ad: false,
  published_at: new Date(NOW - n * HOUR),
  type: 'vacancy',
  url: `https://xn--80aaac0cyed.com/vacancies/${n}`,
  live: true,
  ...extra,
});

const buttons = (view) => view.extra.reply_markup.inline_keyboard.flat();

test('вторая страница: сквозная нумерация и стрелки в обе стороны', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(11 + i));
  const view = menu.publishedView({ rows, from: 'groups', page: 1, pages: 4, total: 37, now: NOW });
  assert.match(view.text, /Из групп<\/b> — сначала новое · всего 37/);
  assert.match(view.text, /Страница 2 из 4/);
  assert.match(view.text, /^11\. 💼 <a href="https:\/\/xn--80aaac0cyed\.com\/vacancies\/11">Объявление 11<\/a>/m);
  assert.match(view.text, /^20\. /m);
  const data = buttons(view).map((b) => b.callback_data);
  assert.ok(data.includes('ldel:11') && data.includes('lspm:20'));
  assert.ok(data.includes('lp:groups:0'), '⬅️ Новее — на первую');
  assert.ok(data.includes('lp:groups:2'), 'Старее ➡️');
  assert.ok(!buttons(view).some((b) => /Свежие/.test(b.text)), 'со второй страницы до первой и так одна кнопка');
  const tabs = buttons(view).filter((b) => b.callback_data.startsWith('lp:') && b.callback_data.endsWith(':0') && !/Новее/.test(b.text));
  assert.deepEqual(tabs.map((b) => b.text), ['✅ Из групп', 'Мои', 'Всё']);
});

test('последняя страница: без «Старее», с возвратом к свежим', () => {
  const view = menu.publishedView({ rows: [row(31)], from: 'groups', page: 3, pages: 4, total: 31, now: NOW });
  const texts = buttons(view).map((b) => b.text);
  assert.ok(texts.includes('⏮ Свежие'));
  assert.ok(texts.includes('⬅️ Новее'));
  assert.ok(!texts.includes('Старее ➡️'));
});

test('сошедшее с сайта — с пометкой и без ссылки; своё — без 🚫', () => {
  const rows = [
    row(1, { live: false, url: '', type: 'board' }),
    row(2, { source: 'telegram', is_ad: true }),
  ];
  const view = menu.publishedView({ rows, from: 'all', page: 0, pages: 1, total: 2, now: NOW });
  assert.match(view.text, /^1\. 📌 Объявление 1 · .* · ⌛ уже не на сайте$/m);
  assert.match(view.text, /^2\. 📣 <a .*>Объявление 2<\/a> · .* · ✍️ ваше$/m);
  const data = buttons(view).map((b) => b.callback_data);
  assert.ok(data.includes('lspm:1'));
  assert.ok(!data.includes('lspm:2'), 'чёрный список — только для постов из групп');
  assert.ok(!buttons(view).some((b) => /Новее|Старее/.test(b.text)), 'одна страница — без стрелок');
});

test('пустая вкладка — подсказка и вкладки, чтобы переключиться', () => {
  const view = menu.publishedView({ rows: [], from: 'mine', total: 0, now: NOW });
  assert.match(view.text, /Присланное вами/);
  assert.match(view.text, /ещё ничего не присылали/);
  assert.deepEqual(buttons(view).map((b) => b.text), ['Из групп', '✅ Мои', 'Всё', '☰ Меню']);
});

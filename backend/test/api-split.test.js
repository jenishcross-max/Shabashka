// Больше 4096 знаков Telegram в одно сообщение не берёт и отвечает «message is
// too long» — вместо ответа админ получал ошибку. Длинное режем на части, но
// резать можно не где угодно: разрубленное «&amp;», недописанный тег или
// половина эмодзи — это уже битый HTML, и Telegram его тоже не примет
// (см. splitText в src/telegram/api.js).
const test = require('node:test');
const assert = require('node:assert/strict');

const tg = require('../src/telegram/api');

const MAX = 4096;

test('короткий текст остаётся одним куском', () => {
  assert.deepEqual(tg.splitText('обычный ответ бота'), ['обычный ответ бота']);
});

test('длинный текст режется по пустой строке, а куски влезают в лимит', () => {
  const block = `${'слово '.repeat(200).trim()}\n\n`;
  const text = block.repeat(6);
  const parts = tg.splitText(text);
  assert.ok(parts.length > 1, 'разрезали');
  for (const part of parts) assert.ok(part.length <= MAX, `кусок длиной ${part.length}`);
  // На месте разреза перевод строки не нужен — следующая часть и так начинается
  // с новой строки. Поэтому сверяем слова, а не байты: важно, что ни одно не
  // потерялось и не срослось с соседним.
  const words = (s) => s.split(/\s+/).filter(Boolean);
  assert.deepEqual(parts.flatMap(words), words(text));
});

test('строка не рубится посреди слова, когда есть где перенести', () => {
  const parts = tg.splitText(`${'а'.repeat(50)}\n`.repeat(200));
  for (const part of parts.slice(0, -1)) {
    assert.ok(part.endsWith('а') || part.endsWith('\n'), 'кусок кончается на границе строки');
  }
});

test('HTML-мнемоника не разрубается пополам', () => {
  // Набиваем текст так, чтобы «&amp;» оказалась ровно на границе.
  const text = `${'я'.repeat(MAX - 2)}&amp;${'я'.repeat(100)}`;
  const [first] = tg.splitText(text);
  assert.ok(!/&[a-z]*$/i.test(first), `кусок кончается на «${first.slice(-6)}»`);
});

test('тег не разрывается и не остаётся без пары', () => {
  const text = `${'я'.repeat(MAX - 10)}<b>жирный кусок текста</b>${'я'.repeat(100)}`;
  const parts = tg.splitText(text);
  for (const part of parts) {
    const open = (part.match(/<b>/g) || []).length;
    const close = (part.match(/<\/b>/g) || []).length;
    assert.equal(open, close, `в куске ${open} открывающих и ${close} закрывающих`);
    assert.ok(!/<[^>]*$/.test(part), 'тег не разрублен');
  }
});

test('эмодзи не разрубается на две половинки', () => {
  const text = `${'я'.repeat(MAX - 1)}🎬${'я'.repeat(100)}`;
  for (const part of tg.splitText(text)) {
    assert.ok(!/[\uD800-\uDBFF]$/.test(part), 'кусок не кончается половиной эмодзи');
    assert.ok(!/^[\uDC00-\uDFFF]/.test(part), 'и не начинается второй половиной');
  }
});

test('экранирование закрывает угловые скобки и амперсанд', () => {
  assert.equal(tg.esc('<b>& "цена"</b>'), '&lt;b&gt;&amp; "цена"&lt;/b&gt;');
  assert.equal(tg.esc(null), '');
  assert.equal(tg.esc(undefined), '');
});

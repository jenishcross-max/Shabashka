// Зарплата в карточке вакансии (src/salary.js). Модель разбора отдаёт голое число, а
// в чатах «1500» пишут и про смену, и про месяц. Месячной зарплаты меньше 5 000 сом
// не бывает — значит, это за день. Меньше 300 — ошибка разбора («10 сом»): её не
// показываем (аудит 12 ноября 2026, см. docs/research/2026-11-audit.md). Пороги —
// те же, что у разметки для Google (backend/src/salaryUnit.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { formatSalary } from '../src/salary.js';

const backend = createRequire(import.meta.url)('../../backend/src/salaryUnit.js');

test('месячная зарплата — как раньше', () => {
  assert.equal(formatSalary(40000, null), 'от 40 000 сом');
  assert.equal(formatSalary(30000, 45000), '30 000–45 000 сом');
  assert.equal(formatSalary(null, 50000), 'до 50 000 сом');
  assert.equal(formatSalary(null, null), 'По договорённости');
});

test('меньше 5 000 сом — за день', () => {
  assert.equal(formatSalary(1500, null), 'от 1 500 сом в день');
  assert.equal(formatSalary(1200, 2000), '1 200–2 000 сом в день');
});

test('меньше 300 сом — ошибка разбора, не зарплата', () => {
  assert.equal(formatSalary(10, null), 'По договорённости');
  assert.equal(formatSalary(250, 1500), 'до 1 500 сом в день');
});

test('пороги — те же, что у разметки для Google', () => {
  assert.equal(backend.JUNK_BELOW, 300);
  assert.equal(backend.DAILY_UP_TO, 4999);
});

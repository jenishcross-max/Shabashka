// Какой ролик-вакансия выходит в Instagram пробным (см. src/social/trial.js и
// publishReel в src/social/instagram.js). По умолчанию — ни один: включает
// владелец переменной IG_TRIAL_EVERY, когда решит проверить, дают ли пробные
// ролики больше подписчиков (docs/plans/2026-11-22-whatsapp-instagram-growth.md).
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.IG_TRIAL_EVERY;
const trial = require('../src/social/trial');

test('по умолчанию пробных роликов нет', () => {
  const off = trial.create(undefined);
  assert.deepEqual([off(), off(), off()], [false, false, false]);
  assert.equal(trial.next(), false);
});

test('IG_TRIAL_EVERY=2 — каждый второй, 1 — все, off — ни один', () => {
  const half = trial.create('2');
  assert.deepEqual([half(), half(), half(), half()], [false, true, false, true]);
  const all = trial.create('1');
  assert.deepEqual([all(), all()], [true, true]);
  const off = trial.create('off');
  assert.deepEqual([off(), off()], [false, false]);
});

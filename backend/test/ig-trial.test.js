// Какой ролик-вакансия выходит в Instagram пробным (см. src/social/trial.js и
// publishReel в src/social/instagram.js). По умолчанию — каждый второй: так
// решил владелец 24 ноября 2026, чтобы сравнить пробные с обычными
// (docs/plans/2026-11-22-whatsapp-instagram-growth.md). IG_TRIAL_EVERY=off — ни один.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.IG_TRIAL_EVERY;
const trial = require('../src/social/trial');

test('по умолчанию пробный — каждый второй', () => {
  const half = trial.create(undefined);
  assert.deepEqual([half(), half(), half(), half()], [false, true, false, true]);
  assert.deepEqual([trial.next(), trial.next()], [false, true]);
});

test('IG_TRIAL_EVERY=2 — каждый второй, 1 — все, off — ни один', () => {
  const half = trial.create('2');
  assert.deepEqual([half(), half(), half(), half()], [false, true, false, true]);
  const all = trial.create('1');
  assert.deepEqual([all(), all()], [true, true]);
  const off = trial.create('off');
  assert.deepEqual([off(), off()], [false, false]);
});

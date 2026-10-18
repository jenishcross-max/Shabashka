// Посадочные страницы /rabota/<slug> (исследование 18 октября 2026, см.
// docs/research): тексты и фильтры — во frontend/src/landings.js, а бэкенду для
// sitemap и подписки в боте нужен тот же список адресов и категорий
// (src/landings.js). Две копии разойдутся на первой правке — здесь их сверяем.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const backend = require('../src/landings');
const professionCategories = require('../src/professionCategories');

test('список страниц на бэкенде совпадает с фронтендом', async () => {
  const file = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'landings.js');
  const { LANDINGS } = await import(pathToFileURL(file).href);
  assert.deepEqual(
    backend.map(({ slug, category }) => ({ slug, category })),
    LANDINGS.map(({ slug, params }) => ({ slug, category: (params && params.category) || null }))
  );
});

test('у каждой профессии из списка категорий — своя страница', () => {
  const covered = new Set(backend.map((l) => l.category).filter(Boolean));
  for (const category of professionCategories) assert.ok(covered.has(category), category);
  assert.equal(new Set(backend.map((l) => l.slug)).size, backend.length, 'адреса не повторяются');
});

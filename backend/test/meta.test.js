// Страница объявления для роботов (см. src/meta.js). Googlebot получал на ней
// <meta http-equiv="refresh"> на тот же адрес и пустое тело: в Search Console
// это «Ошибка переадресации», а 3,6 тыс. объявлений не попадали в индекс.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { install, at } = require('./helpers/stub');

process.env.PUBLIC_URL = 'https://xn--80aaac0cyed.com';

const VACANCY = {
  id: 131,
  title: 'Официантка и уборщица нужны',
  description: '1 официантка, 1 уборщица нужны.\nГрафик с 09:00 до 19:00.\n\nАдрес: Ош базар. <script>alert(1)</script>',
  category: 'Другое',
  city: 'Бишкек',
  address: 'Ош базар',
  work_format: 'offline',
  employment_type: 'shift',
  experience: 'no_experience',
  requirements: 'Девушки от 20 до 25 лет',
  conditions: '',
  schedule: null,
  salary_min: 1500,
  salary_max: null,
  status: 'open',
  for_students: false,
  created_at: '2026-08-05T10:00:00Z',
  owner_name: 'Шабашка',
};

const ORDER = {
  id: 154,
  title: 'Нужен сантехник',
  description: 'Поменять смеситель на кухне',
  category: 'Сантехника',
  city: 'Бишкек',
  address: '',
  work_format: 'offline',
  budget: 2000,
  status: 'closed',
  created_at: '2026-08-05T10:00:00Z',
  owner_name: 'Айбек',
};

const rows = { vacancies: [VACANCY], orders: [ORDER] };

const requireSrc = install({
  [at('db/index.js')]: {
    query: async (sql, params) => {
      const table = /FROM (vacancies|orders)/.exec(sql)[1];
      // Соседние объявления для ссылок внизу.
      if (/ORDER BY \(category/.test(sql)) {
        return { rows: [{ id: 131, title: 'Сама эта вакансия', city: 'Бишкек' }, { id: 200, title: 'Бариста в кофейню', city: 'Бишкек' }] };
      }
      return { rows: rows[table].filter((r) => r.id === params[0]) };
    },
  },
});

const meta = requireSrc('meta.js');

const GOOGLEBOT =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

let base;
let server;
test.before(async () => {
  const app = express();
  app.use(meta);
  app.use((req, res) => res.status(418).send('spa'));
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});
test.after(() => server.close());

const get = (path, ua = GOOGLEBOT) => fetch(`${base}${path}`, { headers: { 'user-agent': ua } });

test('Googlebot получает вакансию целиком, без переадресации на саму себя', async () => {
  const res = await get('/vacancies/131');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.doesNotMatch(html, /http-equiv="refresh"/i, 'переадресация на тот же адрес — «Ошибка переадресации»');
  assert.match(html, /<link rel="canonical" href="https:\/\/xn--80aaac0cyed\.com\/vacancies\/131">/);
  assert.match(html, /<h1>Официантка и уборщица нужны<\/h1>/);
  assert.match(html, /График с 09:00 до 19:00/, 'текст объявления — в самой странице');
  assert.match(html, /<h2>Требования<\/h2>/);
  assert.doesNotMatch(html, /<h2>Условия<\/h2>/, 'пустой раздел не выводим');
  assert.match(html, /от 1 500 сом/);
  assert.match(html, /Сменный график/);
  assert.match(html, /<meta name="description" content="Другое · Бишкек · от 1 500 сом — /);
  assert.doesNotMatch(html, /name="robots"/, 'открытую вакансию индексировать можно');
  assert.doesNotMatch(html, /<script>alert/, 'текст объявления экранирован');
  assert.match(html, /href="https:\/\/xn--80aaac0cyed\.com\/vacancies\/200"/, 'ссылки на соседние вакансии');
  assert.doesNotMatch(html, /Сама эта вакансия/, 'на саму себя страница не ссылается');

  const ld = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(html)[1]);
  assert.equal(ld['@type'], 'JobPosting');
  assert.equal(ld.title, VACANCY.title);
  assert.equal(ld.jobLocation.address.addressLocality, 'Бишкек');
  assert.equal(ld.baseSalary.value.minValue, 1500);
});

test('закрытое объявление — превью остаётся, из поиска уходит', async () => {
  const res = await get('/orders/154');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /Объявление закрыто/);
  assert.match(html, /og:title" content="Нужен сантехник — Шабашка"/);
  assert.match(html, /2 000 сом/);

  rows.vacancies = [{ ...VACANCY, status: 'closed' }];
  const closed = await (await get('/vacancies/131')).text();
  assert.doesNotMatch(closed, /JobPosting/, 'закрытую вакансию Google не покажет в блоке вакансий как открытую');
  rows.vacancies = [VACANCY];
});

test('нет такого объявления — 404 с noindex, а не пустая страница', async () => {
  const res = await get('/vacancies/999');
  assert.equal(res.status, 404);
  assert.match(await res.text(), /<meta name="robots" content="noindex">/);
});

test('человек и чужие адреса идут дальше, на SPA', async () => {
  assert.equal((await get('/vacancies/131', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0')).status, 418);
  assert.equal((await get('/orders/new')).status, 418);
});

test('«Проверка URL» в Search Console видит то же, что Googlebot', async () => {
  const res = await get('/vacancies/131', 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)');
  assert.match(await res.text(), /<h1>Официантка и уборщица нужны<\/h1>/);
});

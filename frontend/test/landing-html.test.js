// Посадочные страницы в HTML до JavaScript (см. netlify/edge-functions/landing-meta.js).
// SPA отдаёт на любой адрес один и тот же index.html: у всех страниц одинаковые
// заголовок и описание и пустой #root. Превью в Telegram и WhatsApp и часть
// поисковиков JavaScript не выполняют — для них страница «Работа в общепите»
// была бы главной.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { landingHtml } from '../netlify/lib/landingHtml.js';
import { LANDINGS, landingBySlug } from '../src/landings.js';

const INDEX = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const URL_ = 'https://xn--80aaac0cyed.com/rabota/obshchepit';

test('заголовок, описание, og и canonical — свои у страницы', () => {
  const landing = landingBySlug('obshchepit');
  const html = landingHtml(INDEX, { landing, url: URL_ });
  assert.match(html, /<title>Работа в общепите в Бишкеке: официант, повар — Шабашка<\/title>/);
  assert.match(html, /<meta\s+name="description"\s+content="Вакансии кафе, ресторанов и фастфуда в Бишкеке/);
  assert.match(html, /<meta property="og:title" content="Работа в общепите в Бишкеке: официант, повар — Шабашка"/);
  assert.match(html, /<meta\s+property="og:description"\s+content="Вакансии кафе/);
  assert.match(html, /<meta property="og:url" content="https:\/\/xn--80aaac0cyed\.com\/rabota\/obshchepit"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/xn--80aaac0cyed\.com\/rabota\/obshchepit" \/>\s*<\/head>/);
  assert.equal((html.match(/<title>/g) || []).length, 1, 'заголовок один');
});

test('в #root — H1, вводный текст и ссылки на соседние страницы', () => {
  const landing = landingBySlug('obshchepit');
  const html = landingHtml(INDEX, { landing, url: URL_ });
  const root = html.slice(html.indexOf('<div id="root">'));
  assert.match(root, /^<div id="root"><main class="landing"><h1>Работа в общепите в Бишкеке<\/h1>/);
  assert.match(root, /<p>Официанты, повара, бариста/);
  assert.match(root, /<a href="\/rabota\/prodazhi">Продавцы<\/a>/);
  assert.doesNotMatch(root, /<ul class="landing-list">/, 'без объявлений — без пустого списка');
});

test('объявления для робота — ссылками, текст экранирован', () => {
  const landing = landingBySlug('obshchepit');
  const items = [
    { id: 5979, title: 'Кассага и повар керек <Фас Фудка>' },
    { id: 5980, title: 'Официант "в кафе" & бар' },
  ];
  const html = landingHtml(INDEX, { landing, url: URL_, items });
  assert.match(html, /<li><a href="\/vacancies\/5979">Кассага и повар керек &lt;Фас Фудка&gt;<\/a><\/li>/);
  assert.match(html, /<a href="\/vacancies\/5980">Официант &quot;в кафе&quot; &amp; бар<\/a>/);

  const orders = landingHtml(INDEX, { landing: landingBySlug('segodnya'), url: URL_, items: [{ id: 7, title: 'Грузчики' }] });
  assert.match(orders, /<a href="\/orders\/7">Грузчики<\/a>/);
});

test('кыргызская страница — lang="ky"', () => {
  const html = landingHtml(INDEX, { landing: landingBySlug('jumush'), url: URL_ });
  assert.match(html, /<html lang="ky">/);
  assert.match(html, /<h1>Бишкектен жумуш<\/h1>/);
});

test('у каждой страницы заголовок и описание укладываются в выдачу', () => {
  for (const l of LANDINGS) {
    assert.ok(`${l.title} — Шабашка`.length <= 70, `${l.slug}: заголовок ${l.title.length}`);
    assert.ok(l.description.length <= 170, `${l.slug}: описание ${l.description.length}`);
    assert.ok(l.h1 && l.intro && l.short, l.slug);
  }
  assert.equal(new Set(LANDINGS.map((l) => l.slug)).size, LANDINGS.length, 'адреса не повторяются');
});

// Сам обработчик Netlify: человеку — без похода в API, роботу — со списком
// объявлений, а чужой адрес и не-HTML не трогаем.
test('edge-функция: человек, робот и чужой адрес', async () => {
  const { default: handle } = await import('../netlify/edge-functions/landing-meta.js');
  const context = { next: async () => new Response(INDEX, { headers: { 'content-type': 'text/html; charset=utf-8' } }) };
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ vacancies: [{ id: 12, title: 'Официант' }], total: 1 }));
  };
  const request = (path, ua = 'Mozilla/5.0') => new Request(`https://xn--80aaac0cyed.com${path}`, { headers: { 'user-agent': ua } });
  try {
    const human = await (await handle(request('/rabota/obshchepit'), context)).text();
    assert.match(human, /<h1>Работа в общепите в Бишкеке<\/h1>/);
    assert.equal(asked.length, 0, 'человеку в API не ходим');

    const bot = await (await handle(request('/rabota/obshchepit', 'TelegramBot (like TwitterBot)'), context)).text();
    assert.match(bot, /<a href="\/vacancies\/12">Официант<\/a>/);
    assert.match(asked[0], /\/api\/vacancies\?category=%D0%9E%D0%B1%D1%89%D0%B5%D0%BF%D0%B8%D1%82&city=.+&limit=24$/);

    const unknown = await handle(request('/rabota/net-takoy'), context);
    assert.equal(await unknown.text(), INDEX, 'неизвестную страницу отдаём как есть — её покажет 404 SPA');
  } finally {
    globalThis.fetch = realFetch;
  }
});

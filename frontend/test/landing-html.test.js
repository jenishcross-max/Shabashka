// Посадочные страницы в HTML до JavaScript (см. netlify/edge-functions/landing-meta.js).
// SPA отдаёт на любой адрес один и тот же index.html: у всех страниц одинаковые
// заголовок и описание и пустой #root. Превью в Telegram и WhatsApp и часть
// поисковиков JavaScript не выполняют — для них страница «Работа в общепите»
// была бы главной.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { landingHtml } from '../netlify/lib/landingHtml.js';
import { LANDINGS, SECTIONS, landingBySlug, listPath, sectionByPath } from '../src/landings.js';

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

// Поиск 24 ноября 2026 (Search Console за 3 месяца): «работа бишкек» — 8-е место,
// «работа каракол», «кара-балта», «джалал-абад», «без опыта», «онлайн работа» —
// показы есть, а страниц нет. Города, «без опыта» и «онлайн» — свои страницы.
test('страницы по городам и стране', () => {
  const kg = landingBySlug('kyrgyzstan');
  assert.equal(kg.h1, 'Работа в Кыргызстане');
  assert.deepEqual(kg.params, {});
  assert.equal(landingBySlug('bishkek').h1, 'Работа в Бишкеке');
  for (const [slug, h1, city] of [
    ['osh', 'Работа в Оше', 'Ош'],
    ['karakol', 'Работа в Караколе', 'Каракол'],
    ['kara-balta', 'Работа в Кара-Балте', 'Кара-Балта'],
    ['jalal-abad', 'Работа в Джалал-Абаде', 'Жалал-Абад'],
    ['cholpon-ata', 'Работа в Чолпон-Ате', 'Чолпон-Ата'],
    ['naryn', 'Работа в Нарыне', 'Нарын'],
  ]) {
    const l = landingBySlug(slug);
    assert.ok(l, slug);
    assert.equal(l.group, 'city');
    assert.equal(l.h1, h1);
    assert.equal(l.params.city, city, slug);
    // Вне Бишкека вакансий по 2–10: без разовых заказов страница была бы пустой.
    assert.equal(l.orders, true, `${slug}: с заказами`);
  }
});

test('«без опыта» и «онлайн» — фильтры API, а «смотреть все» — не на общий список', () => {
  assert.deepEqual(landingBySlug('bez-opyta').params, { experience: 'no_experience', city: 'Бишкек' });
  assert.deepEqual(landingBySlug('onlayn').params, { workFormat: 'online' });
  // Список вакансий на сайте этих фильтров не знает — ссылка показала бы всё подряд.
  assert.equal(listPath(landingBySlug('bez-opyta')), null);
  assert.equal(listPath(landingBySlug('onlayn')), null);
  assert.equal(listPath(landingBySlug('karakol')), '/vacancies?city=%D0%9A%D0%B0%D1%80%D0%B0%D0%BA%D0%BE%D0%BB');
  assert.equal(listPath(landingBySlug('podrabotka')), '/orders?city=%D0%91%D0%B8%D1%88%D0%BA%D0%B5%D0%BA');
});

test('у страницы города в списке для робота — и вакансии, и заказы', () => {
  const html = landingHtml(INDEX, {
    landing: landingBySlug('karakol'),
    url: 'https://xn--80aaac0cyed.com/rabota/karakol',
    items: [
      { id: 3, title: 'Повар', kind: 'vacancies' },
      { id: 4, title: 'Покрасить забор', kind: 'orders' },
    ],
  });
  assert.match(html, /<a href="\/vacancies\/3">Повар<\/a>/);
  assert.match(html, /<a href="\/orders\/4">Покрасить забор<\/a>/);
  assert.match(html, /<a href="\/rabota\/osh">Ош<\/a>/, 'ссылки на соседние города');
});

// Главная, /vacancies и /orders: SPA отдаёт роботу пустой #root, а в заголовке
// главной не было ни «работы», ни «Бишкека».
test('главная и разделы — свои заголовок, H1 и ссылки на все страницы', () => {
  const home = sectionByPath('/');
  assert.match(home.title, /^Работа и подработка в Бишкеке и Кыргызстане/);
  const html = landingHtml(INDEX, { landing: home, url: 'https://xn--80aaac0cyed.com/', items: [{ id: 9, title: 'Швея' }] });
  assert.match(html, /<title>Работа и подработка в Бишкеке и Кыргызстане — Шабашка<\/title>/);
  assert.match(html, /<h1>Работа и подработка в Бишкеке и Кыргызстане<\/h1>/);
  assert.match(html, /<a href="\/vacancies\/9">Швея<\/a>/);
  assert.match(html, /<a href="\/rabota\/bishkek">Бишкек<\/a>/);
  assert.match(html, /<a href="\/rabota\/obshchepit">Общепит<\/a>/);
  assert.match(sectionByPath('/vacancies').h1, /^Вакансии/);
  assert.equal(sectionByPath('/orders').kind, 'orders');
  assert.equal(sectionByPath('/login'), null);
  for (const s of SECTIONS) {
    assert.ok(`${s.title} — Шабашка`.length <= 70, `${s.path}: заголовок`);
    assert.ok(s.description.length <= 170, `${s.path}: описание`);
  }
});

test('edge-функция разделов: человеку — как есть, роботу — HTML со списком', async () => {
  const { default: handle } = await import('../netlify/edge-functions/section-meta.js');
  const context = { next: async () => new Response(INDEX, { headers: { 'content-type': 'text/html; charset=utf-8' } }) };
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ vacancies: [{ id: 21, title: 'Продавец' }], total: 1 }));
  };
  const request = (path, ua = 'Mozilla/5.0') => new Request(`https://xn--80aaac0cyed.com${path}`, { headers: { 'user-agent': ua } });
  try {
    const human = await (await handle(request('/'), context)).text();
    assert.equal(human, INDEX, 'человеку главная без изменений — React нарисует её сам');
    assert.equal(asked.length, 0);

    const bot = await (await handle(request('/', 'Mozilla/5.0 (compatible; YandexBot/3.0)'), context)).text();
    assert.match(bot, /<h1>Работа и подработка в Бишкеке и Кыргызстане<\/h1>/);
    assert.match(bot, /<a href="\/vacancies\/21">Продавец<\/a>/);
    assert.match(bot, /<link rel="canonical" href="https:\/\/xn--80aaac0cyed\.com\/" \/>/);
    assert.match(asked[0], /\/api\/vacancies\?limit=24$/);

    const list = await (await handle(request('/vacancies?category=x', 'Googlebot/2.1'), context)).text();
    assert.match(list, /<link rel="canonical" href="https:\/\/xn--80aaac0cyed\.com\/vacancies" \/>/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('edge-функция: робот на странице города получает вакансии и заказы', async () => {
  const { default: handle } = await import('../netlify/edge-functions/landing-meta.js');
  const context = { next: async () => new Response(INDEX, { headers: { 'content-type': 'text/html; charset=utf-8' } }) };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const kind = /\/api\/orders/.test(String(url)) ? 'orders' : 'vacancies';
    return new Response(JSON.stringify({ [kind]: [{ id: kind === 'orders' ? 8 : 7, title: kind }], total: 1 }));
  };
  try {
    const req = new Request('https://xn--80aaac0cyed.com/rabota/naryn', { headers: { 'user-agent': 'Googlebot' } });
    const html = await (await handle(req, context)).text();
    assert.match(html, /<a href="\/vacancies\/7">vacancies<\/a>/);
    assert.match(html, /<a href="\/orders\/8">orders<\/a>/);
  } finally {
    globalThis.fetch = realFetch;
  }
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

// Поиск 24 ноября 2026: «глобус вакансии», «работа в глобусе бишкек» — около 390
// показов за 3 месяца, а своей страницы не было. На ней — вакансии, где «Глобус»
// назван прямо; с компанией мы не связаны — так и пишем.
test('страница «Глобуса»: оба написания, листает сама, оговорка в тексте', () => {
  const l = landingBySlug('globus');
  assert.equal(l.group, 'employer');
  assert.deepEqual(l.params, { words: ['глобус', 'globus'] });
  assert.equal(l.hideEmpty, true);
  assert.equal(listPath(l), null, 'список вакансий не знает words — «Показать ещё» здесь же');
  assert.match(l.intro, /Шабашка не связана с «Глобусом»/);
});

test('noindex — только когда попросили', () => {
  const landing = landingBySlug('globus');
  const url = 'https://xn--80aaac0cyed.com/rabota/globus';
  assert.match(landingHtml(INDEX, { landing, url, noindex: true }), /<meta name="robots" content="noindex" \/>\s*<link rel="canonical"/);
  assert.doesNotMatch(landingHtml(INDEX, { landing, url }), /name="robots"/);
});

test('edge-функция: «Глобус» без вакансий — роботу noindex, а сбой API и пустой город — нет', async () => {
  const { default: handle } = await import('../netlify/edge-functions/landing-meta.js');
  const context = { next: async () => new Response(INDEX, { headers: { 'content-type': 'text/html; charset=utf-8' } }) };
  const realFetch = globalThis.fetch;
  const asked = [];
  let reply = { vacancies: [], total: 0 };
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    if (!reply) throw new Error('timeout');
    return new Response(JSON.stringify(reply));
  };
  const open = async (path, ua = 'Googlebot/2.1') =>
    (await handle(new Request(`https://xn--80aaac0cyed.com${path}`, { headers: { 'user-agent': ua } }), context)).text();
  try {
    assert.match(await open('/rabota/globus'), /<meta name="robots" content="noindex" \/>/);
    assert.match(asked[0], /\/api\/vacancies\?words=%D0%B3%D0%BB%D0%BE%D0%B1%D1%83%D1%81%2Cglobus&limit=24$/);
    assert.doesNotMatch(await open('/rabota/globus', 'Mozilla/5.0'), /name="robots"/, 'человеку — как обычно');

    reply = { vacancies: [{ id: 8380, title: 'Продавец в Глобус Маркет' }], total: 1 };
    const full = await open('/rabota/globus');
    assert.doesNotMatch(full, /name="robots"/);
    assert.match(full, /<a href="\/vacancies\/8380">Продавец в Глобус Маркет<\/a>/);

    reply = null;
    assert.doesNotMatch(await open('/rabota/globus'), /name="robots"/, 'бэкенд не ответил — не прячем');

    // В маленьком городе пусто бывает день-два — такую страницу не прячем.
    reply = { vacancies: [], orders: [], total: 0 };
    assert.doesNotMatch(await open('/rabota/batken'), /name="robots"/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

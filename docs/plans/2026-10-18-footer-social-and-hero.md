# Логотипы соцсетей и первый экран главной — план

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** официальные логотипы Instagram, Threads и Telegram в футере и в блоке соцсетей главной; фирменный «живой» первый экран главной.

**Architecture:** адреса и логотипы соцсетей — в одном `components/SocialLinks.jsx` (SVG-контуры Simple Icons, CC0, без внешних картинок), их берут футер и главная. Строка «за сутки» — два новых поля в `counts` того же `/api/home` (тот же кэш `home:counts` на минуту). Мазок под «Шабашка» и узор из знака «ш» — CSS с SVG в data-URI, без новых файлов и запросов.

**Tech Stack:** Express + Postgres (PGlite в тестах, `node --test`), React 18 + Router 6 + Vite, один `index.css`.

Решения из обсуждения (2026-10-18): TikTok не нужен — только Instagram, Threads, Telegram. Первый экран — вариант «Фирменный и живой» с «Часто ищут».

---

### Task 1: счёт «за сутки» в `/api/home`

**Files:**
- Modify: `backend/src/routes/home.js` (запрос `home:counts`)
- Test: `backend/test/ads-route.test.js` (рядом с тестом счётчиков)

**Step 1: падающий тест** — после теста «главная отдаёт счётчики открытого по разделам»:

```js
// Живая строка над заголовком главной: сколько открытых заказов и вакансий
// появилось за последние сутки. Старое и закрытое не считается.
test('главная считает заказы и вакансии за сутки', async () => {
  const { invalidate } = requireSrc('cache.js');
  const owner = await user('Бакыт');
  const order = (status, age) =>
    db.query(
      `INSERT INTO orders (user_id, title, description, category, city, status, created_at)
       VALUES ($1, 'Подработка', 'Нужна помощь', 'Другое', 'Бишкек', $2, now() - $3::interval)`,
      [owner.id, status, age]
    );
  const vacancy = (age) =>
    db.query(
      `INSERT INTO vacancies (user_id, title, description, category, city, employment_type, created_at)
       VALUES ($1, 'Продавец', 'Работа в магазине', 'Другое', 'Бишкек', 'full', now() - $2::interval)`,
      [owner.id, age]
    );
  invalidate('home:');
  const before = (await call('/home')).body.counts;

  await order('open', '1 hour');
  await order('open', '23 hours');
  await order('open', '2 days'); // старый
  await order('closed', '1 hour'); // закрытый
  await vacancy('2 hours');
  await vacancy('3 days'); // старая
  invalidate('home:');
  const after = (await call('/home')).body.counts;

  assert.equal(after.today_orders - before.today_orders, 2);
  assert.equal(after.today_vacancies - before.today_vacancies, 1);
});
```

**Step 2:** `cd backend && node --test test/ads-route.test.js` — FAIL (`NaN !== 2`).

**Step 3:** в запрос `home:counts` добавить два подсчёта:

```sql
(SELECT COUNT(*)::int FROM orders
  WHERE status = 'open' AND created_at > now() - interval '24 hours') AS today_orders,
(SELECT COUNT(*)::int FROM vacancies
  WHERE status = 'open' AND created_at > now() - interval '24 hours') AS today_vacancies
```

**Step 4:** тот же файл — PASS, затем весь набор `node --test test/*.test.js`.

### Task 2: `SocialLinks.jsx` — адреса и логотипы

**Files:** Create `frontend/src/components/SocialLinks.jsx`; Modify `frontend/src/index.css` (блок `.social-icon`).

- `SOCIALS = [{ id: 'instagram', name: 'Instagram', url }, { id: 'threads', name: 'Threads', url }, { id: 'telegram', name: 'Telegram-канал', url }]` — адреса из нынешнего футера.
- `SocialIcon({ id })`:
  - Instagram — белый контур Simple Icons в квадрате с фирменным градиентом (`radial-gradient` в CSS — без `id` у `<linearGradient>`, которые повторялись бы на странице дважды);
  - Threads — белый знак в чёрном квадрате (так выглядит их значок);
  - Telegram — контур Simple Icons (круг с прорезью-самолётиком) цветом `#26A5E4` поверх белого круга: прорезь становится белым самолётиком.
- CSS: `.social-icon` 22×22, `flex: none`; градиент Instagram; чёрный Threads с тонкой светлой рамкой в тёмном футере.

### Task 3: футер

**Files:** Modify `frontend/src/components/Footer.jsx`, `frontend/src/index.css`.

Колонка «Мы в соцсетях» — `SOCIALS.map(...)`: `<a className="footer-social">` с `SocialIcon` и названием, `rel="noopener noreferrer me"` и комментарий про поисковик сохраняются. CSS: `.site-footer a.footer-social { display: inline-flex; align-items: center; gap: 10px; }`.

### Task 4: блок соцсетей внизу главной

**Files:** Modify `frontend/src/pages/Home.jsx`.

Убрать `INSTAGRAM_URL`/`TELEGRAM_URL`, рисовать `SOCIALS.map(...)` в `.hero-social` с `SocialIcon`; у Instagram — прежний счётчик подписчиков. Threads добавляется сам.

### Task 5: первый экран

**Files:** Modify `frontend/src/pages/Home.jsx`, `frontend/src/index.css`.

- `freshLine(counts)` → `«+19 заказов и +73 вакансии за сутки»` (`orderWord`, `vacancyWord`); нули пропускаются, оба нуля → `null`.
- Над `<h1>`: `div.hero-live` с зелёной точкой. Пока главная грузится — та же плашка невидимой (`is-pending`), чтобы заголовок не прыгал; после загрузки без новых — плашки нет.
- `<h1><span className="hero-brand">Шабашка</span> в Кыргызстане</h1>`; `.hero-brand` красный, `::after` — мазок (SVG data-URI, полупрозрачный красный) под словом, за текстом.
- `.hero::before` — узор из знака «ш» (две «U» логотипа, data-URI, шаг 72 px, на телефоне 52 px), гаснет к низу через `mask-image`; у `.hero` — `position: relative; isolation: isolate`.
- Под поиском `div.hero-popular`: «Часто ищут:» и ссылки `POPULAR = ['Уборка', 'Грузчик', 'Ремонт', 'Электрик', 'Швея']` → `/orders?q=<слово>` (по каждому на живом сайте 2026-10-18 есть заказы: 17 / 15 / 12 / 6 / 4). На телефоне — одна строка с прокруткой вбок.
- Точка мигает через `@keyframes`; `prefers-reduced-motion: reduce` — без анимации.

### Task 6: проверка

- `cd backend && node --test test/*.test.js` — всё зелёное.
- `cd frontend && npm run build` — без ошибок.
- Заглушка API (`counts.today_orders/today_vacancies`), браузер 375 / 768 / 1280: плашка, мазок, узор, «Часто ищут» (на 375 — прокрутка, без горизонтальной прокрутки страницы), логотипы в футере и в блоке соцсетей узнаются, ссылки ведут на профили.

---

## Как сделано (2026-10-18)

Все шесть задач выполнены по плану.

- `/api/home` → `counts.today_orders`, `counts.today_vacancies` (открытые, созданные за 24 часа). Тест «главная считает заказы и вакансии за сутки» в `ads-route.test.js`; бэкенд 359/359 (три прогона подряд).
- `components/SocialLinks.jsx`: контуры сверены с `simple-icons@13.21.0` по SHA-1 — совпадают байт в байт. В футере и в блоке внизу главной — Instagram, Threads, Telegram с логотипами; Threads в блоке главной появился впервые.
- Первый экран: плашка «+19 заказов и +73 вакансии за сутки» (при нулях её нет — проверено на заглушке), красное «Шабашка» с мазком маркера, узор из знака «ш», «Часто ищут». После первого просмотра узор сделан бледнее (`.075`), мазок — толще.
- Проверка: `npm run build` без ошибок; заглушка API, 1280 / 768 / 375 px — без горизонтальной прокрутки, «Часто ищут» на телефоне листается вбок (556 px ленты в 375 px), «Уборка» ведёт на `/orders?q=уборка` с заполненным поиском; ошибок в консоли нет.

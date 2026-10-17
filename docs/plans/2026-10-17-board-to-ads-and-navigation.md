# Доска → Объявления, новая навигация, главная и карточки — план реализации

> **Для Claude:** выполнять по задачам скиллом executing-plans (или subagent-driven-development в этой же сессии). Коммит и пуш — **только по команде пользователя «комит пуш»**, поэтому шаг «Commit» в задачах означает «изменения готовы, тесты зелёные, ничего не коммитим».

**Цель:** убрать «Доску №24» и отдавать её посты в «Объявления», сделать шапку в одну строку с «+ Разместить ▾» и меню профиля, нижнюю панель на телефоне, обновить главную и свести карточки к одной схеме.

**Архитектура:** внутри бота тип `board` остаётся кодом «объявление не про работу» (на нём держатся `SOURCE_LISTING_TYPE`, счётчики сводки, ролики «Объявления дня»), меняется только место публикации: вместо `board_posts` — строка в `ads` с `is_imported = true` и видом/рубрикой от модели. Колонки добавляются в конец `schema.sql` (`ALTER … IF NOT EXISTS`, файл выполняется при каждом старте) — `db/index.js` правит параллельная сессия, его не трогаем. Сайт: `/board` → `/ads`, новая шапка (`Navbar.jsx`), нижняя панель (`BottomNav.jsx`) и переключатель «Подработка | Вакансии | Биржа» (`WorkSwitcher.jsx`), главная с плитками и счётчиками из `/api/home`, единая разметка карточек.

**Стек:** Node/Express + Postgres (тесты на PGlite в памяти, `backend/test/helpers/pglite.js`, `stub.js`), React 18 + Router 6 + Vite. Дизайн — скилл `frontend-design` (Anthropic), фирменные цвета и шрифты остаются.

**Решения из обсуждения (2026-10-17):**
- Посты доски из групп — в «Объявления» (подход A), **без срока**: остаются на сайте, пока их не снимут.
- Новые виды объявлений: «Услуги» (`service`) и «Ищу работу» (`job_search`).
- Навигация: шапка + меню профиля + «+ Разместить ▾»; на телефоне нижняя панель `Главная · Работа · ＋ · Объявления · Профиль`.
- Дизайн: главная и карточки; ленты с фильтрами не трогаем.
- В соцсети объявления от людей по-прежнему не уходят; посты из групп уходят туда же, куда уходили записки доски, меняется только ссылка.

**Нельзя:** запускать бэкенд локально и скрипты, которые лезут в боевую базу (`backend/.env`); трогать без нужды `backend/src/telegram/products.js`, `productViews.js`, `productStore.js`, `backend/src/social/threads.js`, `backend/src/db/index.js`, `README.md` (правит другая сессия; в `schema.sql` и README — только в конец). Концы строк CRLF — после правок `python scratchpad/crlf.py <файлы>`.

Запуск тестов: `cd backend && node --test test/*.test.js`. Сборка: `cd frontend && npm run build`.

---

## Часть 1. Бэкенд

### Задача 1: виды «Услуги» и «Ищу работу»

**Файлы:**
- Изменить: `backend/src/adsRules.js` (`KINDS`)
- Изменить: `frontend/src/ads.js` (`KINDS`, `priceLabel`)
- Тест: `backend/test/ads-rules.test.js`

**Шаг 1 — падающий тест** (в конец `ads-rules.test.js`):

```js
test('услуги и «ищу работу» — обычные виды с ценой', () => {
  for (const kind of ['service', 'job_search']) {
    const { errors, result } = validateAd({ ...VALID, kind, price: '1500', price_unit: 'hour' }, { userId: 7 });
    assert.deepEqual(errors, [], kind);
    assert.equal(result.kind, kind);
    assert.equal(result.price, 1500);
    assert.equal(result.price_unit, 'hour');
  }
});
```
(`VALID` — объект корректного объявления, уже объявленный в файле; если называется иначе — взять его.)

**Шаг 2:** `node --test test/ads-rules.test.js` — FAIL «Выберите, что вы делаете».

**Шаг 3 — реализация:**
```js
// adsRules.js
const KINDS = ['rent_out', 'rent', 'sell', 'buy', 'free', 'service', 'job_search'];
```
```js
// frontend/src/ads.js — в KINDS после 'free':
  ['service', 'Услуги'],
  ['job_search', 'Ищу работу'],
```
В `priceLabel`: для `service` и `job_search` сумма с приставкой «от » (у услуги — цена «от», у «ищу работу» — ожидаемая оплата), как сейчас «до » у `buy`/`rent`.

**Шаг 4:** тест зелёный. **Шаг 5:** без коммита.

### Задача 2: колонки `ads.is_imported` и `imported_listings.ad_id`, создание импортного объявления

**Файлы:**
- Изменить: `backend/src/db/schema.sql` — **в конец**, в блок объявлений
- Изменить: `backend/src/adsRepo.js` (`AD_FIELDS`, `mine`, новая `createImported`)
- Тест: `backend/test/ads-repo.test.js`

**Шаг 1 — падающий тест:**
```js
test('объявление из группы: от имени владельца бота, без фото, не в «Моих»', async () => {
  const owner = await user('Бот');
  const ad = await adsRepo.createImported({
    userId: owner.id, kind: 'rent_out', category: 'housing', title: 'Сдаю квартиру',
    description: '2 комнаты, Джал', price: 25000, city: 'Бишкек', whatsappPhone: '+996700111222',
  });
  assert.equal(ad.is_imported, true);
  assert.deepEqual(ad.photos, []);
  assert.equal(ad.price_unit, 'total');
  assert.equal((await adsRepo.mine(owner.id)).length, 0);
  assert.equal((await adsRepo.get(ad.id)).is_imported, true);
});
```

**Шаг 2:** FAIL «createImported is not a function».

**Шаг 3 — реализация.** В конец `schema.sql`:
```sql
-- Объявления из открытых групп (бот, см. telegram/imports.js): автор не
-- проверен, у объявления плашка «из открытых чатов». Колонки добавляются здесь,
-- а не в CREATE TABLE: таблица на проде уже создана.
ALTER TABLE ads ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE imported_listings ADD COLUMN IF NOT EXISTS ad_id INTEGER;
```
`adsRepo.js`: `ads.is_imported` в `AD_FIELDS`; в `mine` — `AND NOT ads.is_imported` (иначе у админа в «Моих публикациях» окажется вся лента из групп); новая функция:
```js
// Объявление из группы: бот публикует от имени владельца, фото нет, цена — за всё.
async function createImported({ userId, kind, category, title, description, price, city, whatsappPhone }) {
  const { rows } = await db.query(
    `INSERT INTO ads (user_id, kind, category, title, description, price, price_unit, city, whatsapp_phone, is_imported)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true) RETURNING id`,
    [userId, kind, category, title.slice(0, 100), description.slice(0, 3000), price, price ? 'total' : null, city, whatsappPhone]
  );
  return get(rows[0].id);
}
```
Экспортировать `createImported`. В тестовом `before` — те же два `ALTER`, если PGlite-схема берётся не из `schema.sql`.

**Шаг 4:** зелёный. **Шаг 5:** без коммита.

### Задача 3: вид и рубрика объявления в разборе модели

**Файлы:**
- Изменить: `backend/src/telegram/extract.js` (промпт: схема JSON и раздел «Поля»; `normalize`)
- Тест: `backend/test/extract-parse.test.js`

**Шаг 1 — падающий тест:**
```js
test('у объявления — вид и рубрика раздела «Объявления»', async () => {
  const [ok, odd] = await parse([
    { is_listing: true, listing_type: 'board', title: 'Сдаю квартиру', city: 'Бишкек', phone: '0700111222', ad_kind: 'rent_out', ad_category: 'housing' },
    { is_listing: true, listing_type: 'board', title: 'Сантехник, все виды работ', city: 'Бишкек', phone: '0700111222', ad_kind: 'что-то', ad_category: '' },
  ]);
  assert.equal(ok.ad_kind, 'rent_out');
  assert.equal(ok.ad_category, 'housing');
  // Непонятный вид — «Услуги», рубрика — «Другое»: публикуем, а не теряем.
  assert.equal(odd.ad_kind, 'service');
  assert.equal(odd.ad_category, 'other');
});
```

**Шаг 2:** FAIL (`undefined`).

**Шаг 3 — реализация.**
- В JSON-схему промпта добавить `"ad_kind":string,"ad_category":string`.
- В «Поля»: `- ad_kind и ad_category — только для board. ad_kind: rent_out (сдаю), rent (сниму), sell (продаю), buy (куплю), free (отдам даром), service (свои услуги, такси, грузоперевозки, курсы), job_search (ищу работу). ad_category: housing (жильё), rest (пансионаты, гостевые дома), transport, tech, home (мебель, стройка, ремонт), things (одежда, вещи), animals, other.`
- В `normalize` (импорт `KINDS`, `CATEGORIES` из `../adsRules`):
```js
    ad_kind: KINDS.includes(clean(raw.ad_kind)) ? clean(raw.ad_kind) : 'service',
    ad_category: CATEGORIES.includes(clean(raw.ad_category)) ? clean(raw.ad_category) : 'other',
```

**Шаг 4:** зелёный, и весь `extract-*.test.js` тоже. **Шаг 5:** без коммита.

### Задача 4: бот публикует «board» в объявления

**Файлы:**
- Изменить: `backend/src/telegram/imports.js` (`publish`, `bump`, `remove`, `listPublished`; `boardText`/`BOARD_MAX_TEXT` удалить, если больше не нужны)
- Создать тест: `backend/test/imports-ads.test.js` (PGlite, как `spam-sweep.test.js`)

**Шаг 1 — падающий тест:** создать админа и строку `imported_listings` (`status 'pending'`, `parsed` = `{ listing_type:'board', ad_kind:'rent_out', ad_category:'housing', title, description, category:'Другое', city:'Бишкек', phone:'+996700111222', budget:25000 }`), вызвать `imports.publish(id)` и проверить:
- результат `{ type: 'board', id: <id объявления> }`;
- в `ads` строка с `is_imported = true`, `user_id` админа, `kind 'rent_out'`, `price 25000`;
- у импорта `status 'published'`, `ad_id` = id объявления, `board_post_id IS NULL`;
- в `board_posts` пусто;
- `imports.bump(id)` ставит `ads.bumped_at`;
- `imports.listPublished({ from:'all', limit:10, offset:0 })` отдаёт строку с `live = true`;
- `imports.remove(id)` удаляет объявление, пишет `moderation_log` с `listing_type 'ad'`, импорт → `rejected`.

**Шаг 2:** FAIL — пишет в `board_posts`.

**Шаг 3 — реализация** (ветка `board` в `publish`):
```js
  // Не заказ и не вакансия (сдают квартиру, продают машину, предлагают свои
  // услуги) — это объявление раздела «Объявления». Срока нет, как у заказов:
  // висит, пока не снимут через бота или админку.
  if (parsed.listing_type === 'board') {
    const ad = await adsRepo.createImported({
      userId, kind: parsed.ad_kind || 'service', category: parsed.ad_category || 'other',
      title: parsed.title, description: parsed.description, price: amount(parsed.budget),
      city: parsed.city, whatsappPhone: parsed.phone,
    });
    await db.query(
      "UPDATE imported_listings SET status = 'published', published_at = NOW(), ad_id = $1 WHERE id = $2",
      [ad.id, id]
    );
    invalidate('home:');
    return { type: 'board', id: ad.id };
  }
```
`remove`: цель `row.ad_id ? { listingType: 'ad', listingId: row.ad_id } : …` (раньше `board_post_id`, старые импорты оставить). `bump`: `row.ad_id` → `UPDATE ads SET bumped_at = NOW() WHERE id = $1`. `listPublished`: `i.ad_id` в выборку, `LEFT JOIN ads a ON a.id = i.ad_id`, `live` учитывает `a.status = 'open'`.

**Шаг 4:** зелёный, прогнать весь бэкенд (`bot-*.test.js`, `published-view.test.js` и др. — поправить ожидания, где они завязаны на `board_post_id`). **Шаг 5:** без коммита.

### Задача 5: ссылки бота ведут на `/ads/<id>`

**Файлы:**
- Изменить: `backend/src/telegram/bot.js` (`listingUrl` ~544, `publishOne` ~711, реклама ~906, `publishedView` ~2217, `adSiteUrl` ~2883)
- Изменить: `backend/src/telegram/menu.js` (`TYPE_NAMES`, определение типа ~180)
- Тест: ожидания в `published-view.test.js`, `bot-ad.test.js`, `bot-quiet.test.js` (`board#p` → `ads/`)

**Шаг 1 — тест:** в `published-view.test.js` строка импорта с `ad_id` показывает ссылку `…/ads/<id>`; в `bot-ad.test.js` реклама типа board отвечает «✅ Опубликовал: объявление» и ссылкой на `/ads/`.

**Шаг 2:** FAIL.

**Шаг 3 — реализация:** один помощник вместо трёх копий:
```js
// Где объявление живёт на сайте. board — объявление не про работу: с октября
// 2026 это раздел «Объявления», у каждого своя страница.
const LISTING_PATHS = { vacancy: 'vacancies', order: 'orders', board: 'ads' };
function sitePath(type, id) {
  return `${LISTING_PATHS[type]}/${id}`;
}
```
Все `type === 'board' ? \`board#p${id}\` : …` заменить на `sitePath(type, id)`. Определение типа: `ad.vacancy_id ? 'vacancy' : ad.order_id ? 'order' : ad.ad_id ? 'board' : ad.board_post_id ? 'board' : null`, id — `ad.ad_id || ad.board_post_id`. Тексты: «Повесил на доску — сутки, потом пропадёт само» → «✅ Опубликовал: объявление»; `TYPE_NAMES.board` → `'🏷 Объявление'`.

**Шаг 4:** весь бэкенд зелёный. **Шаг 5:** без коммита.

### Задача 6: «Проверка фильтром» и ролики «Объявления дня» — из `ads`

**Файлы:**
- Изменить: `backend/src/spamSweep.js` (источник `ad`: `ads`, `status = 'open'`, `link: 'ad_id'`)
- Изменить: `backend/src/digestRepo.js` (`PICKS.board` → открытые объявления за `DAYS` дней; `toParsed` для board → `title`, `description`, `city`, `budget: price`, `phone: whatsapp_phone`)
- Тест: `backend/test/spam-sweep.test.js` (+ объявление со схемой находится и снимается); тест дайджеста, если есть, — на объявления

**Шаги:** падающий тест → реализация → зелёный → без коммита.

### Задача 7: счётчики для главной

**Файлы:**
- Изменить: `backend/src/routes/home.js` (поле `counts`)
- Тест: `backend/test/ads-route.test.js` (тест главной)

**Шаг 1 — тест:** `GET /api/home` отдаёт `counts` с числами `orders`, `vacancies`, `tasks`, `ads` — по открытым.

**Шаг 3 — реализация:** один запрос под тем же кэшем, что лента:
```js
cached('home:counts', FEED_TTL, async () => (await db.query(
  `SELECT (SELECT COUNT(*)::int FROM orders WHERE status = 'open') AS orders,
          (SELECT COUNT(*)::int FROM vacancies WHERE status = 'open') AS vacancies,
          (SELECT COUNT(*)::int FROM tasks WHERE status = 'open') AS tasks,
          (SELECT COUNT(*)::int FROM ads WHERE status = 'open') AS ads`
)).rows[0])
```
**Шаг 4:** зелёный. **Шаг 5:** без коммита.

---

## Часть 2. Сайт

Перед задачами 9–13 — загрузить скилл `frontend-design` (Anthropic) и держаться его. Проверка каждой задачи — `npm run build` и браузер на заглушке API (`scratchpad/mock-api.js`, временная запись `mock-api` в `.claude/launch.json`, после — `git checkout -- .claude/launch.json`). Бэкенд локально не запускать.

### Задача 8: доска уходит, объявления из групп — с плашкой

**Файлы:**
- Изменить: `frontend/src/App.jsx` (`/board` → `<Navigate to="/ads" replace />`, импорт `Board` убрать)
- Удалить: `frontend/src/pages/Board.jsx`; методы доски в `frontend/src/api.js`, которыми больше никто не пользуется (админские оставить)
- Изменить: `frontend/src/pages/AdDetail.jsx` — для `ad.is_imported`: плашка «Объявление взято из открытых чатов. Автора мы не проверяли…» (текст как у импортных заказов в `OrderDetail.jsx`), форма «Написать в Сообщения» не показывается (владелец — админ), остаётся WhatsApp
- Изменить: `frontend/src/pages/Ads.jsx` — кнопки видов берут `KINDS`, новые появятся сами; проверить перенос строк на 375 px

### Задача 9: шапка

**Файлы:**
- Изменить: `frontend/src/components/Navbar.jsx`
- Создать: `frontend/src/components/NavMenus.jsx` (`PostMenu`, `ProfileMenu`, общий `useDropdown` — закрытие по клику вне и по смене адреса, как в `OrdersMenu`)
- Изменить: `frontend/src/index.css` (блок `.navbar`)

Состав: логотип | Биржа (со счётчиком новых откликов), Подработка ▾, Вакансии, Объявления | ✉ со счётчиком непрочитанных (`/messages`, только вошедшим) · «+ Разместить ▾» (Заказ `/orders/new`, Задачу на бирже `/tasks/new`, Вакансию `/vacancies/new`, Объявление `/ads/new`) · меню профиля (имя ▾: ★ Избранное, Мои публикации, Админ-панель для `role === 'admin'`, Выйти). Гость: «Войти» и «+ Разместить ▾» (защищённые страницы сами уводят на вход). Бургер убрать. Ширина 1024 px — одна строка.

### Задача 10: нижняя панель и переключатель работы

**Файлы:**
- Создать: `frontend/src/components/BottomNav.jsx` — `⌂ Главная` `/`, `⚒ Работа` `/orders` (активна на `/orders`, `/vacancies`, `/tasks`), `＋` (выдвижная панель с теми же пунктами, что «+ Разместить»), `▦ Объявления` `/ads`, `☺ Профиль` (выдвижная панель: пункты меню профиля; гостю — Войти, Регистрация, ★ Избранное). Точка на «Профиле» при `unread > 0 || newOffers > 0`.
- Создать: `frontend/src/components/Sheet.jsx` — выдвижная панель (подложка, закрытие по подложке, Esc и смене адреса, `role="dialog"`)
- Создать: `frontend/src/components/WorkSwitcher.jsx` — `Подработка | Вакансии | Биржа`, только на телефоне (CSS), в начале страниц `Orders.jsx`, `Vacancies.jsx`, `Tasks.jsx`
- Изменить: `frontend/src/App.jsx` — `<BottomNav />` после `<Footer />` вне админки
- Изменить: `frontend/src/index.css` — панель видна до 900 px; `body` отступ снизу на высоту панели + `env(safe-area-inset-bottom)`; панель прячется при открытой клавиатуре: `body:has(input:focus, textarea:focus, select:focus) .bottom-nav { display: none; }`

### Задача 11: главная

**Файлы:** `frontend/src/pages/Home.jsx`, `frontend/src/index.css`

- Первый экран короче: заголовок, подзаголовок в одну-две строки, поиск.
- Плитки «Что ищете?» (4): 🧰 Подработка `/orders` (`counts.orders`), 💼 Вакансии `/vacancies` (`counts.vacancies`), ⚡ Биржа `/tasks` («исполнители предложат цену»), 🏷 Объявления `/ads` (`counts.ads`). Счётчик скрыт, пока `counts` не пришли.
- Строку «Смотреть подработку: Всю / Только офлайн / Только онлайн» убрать; «🎓 Работа для студентов» — плашка под плитками; Instagram и Telegram — полоса перед `cta-banner`.
- Порядок: Свежие заказы (8, скелетон тоже 8) → Биржа (компактная полоса с кнопками, сетка задач, если есть) → Свежие объявления → Свежие вакансии → Заказы по городам → призыв.

### Задача 12: единые карточки

**Файлы:** `OrderCard.jsx`, `VacancyCard.jsx`, `TaskCard.jsx`, `AdCard.jsx`, `frontend/src/index.css`

Схема: сверху одна плашка (рубрика / вид объявления), город · время мелким, ★ справа → заголовок до двух строк (`-webkit-line-clamp: 2`) → одна строка подробностей (вакансия: занятость · опыт; задача: срок и отклики; объявление: рубрика) → описание две строки (у объявления вместо него фото) → снизу крупная цена слева, значки справа только по делу: «Онлайн», «Студентам», «🔥 Топ», «Пример», «Из чатов» (`is_imported`). Плашку «Офлайн» убрать. Классы общие (`order-card…`), у объявления фото-обложка остаётся.

### Задача 13: проверка и описание

- `cd backend && node --test test/*.test.js` — всё зелёное.
- `cd frontend && npm run build` — без ошибок.
- Браузер на заглушке: 375 / 768 / 1280 px — шапка в одну строку, нижняя панель на телефоне, панели «＋» и «Профиль», переключатель работы, `/board` → `/ads`, главная с плитками, карточки; `document.documentElement.scrollWidth === innerWidth`; консоль без ошибок.
- Описание в конец `docs/plans/2026-10-17-board-to-ads-and-navigation.md` — раздел «Как сделано»; README — только в конец, если нужно.
- Нормализовать CRLF (`scratchpad/crlf.py`), без коммита — ждать «комит пуш».

---

## Как сделано (2026-10-17)

Все 13 задач выполнены, отступления от плана — ниже.

**Бэкенд**
- `adsRules.KINDS` + `service`, `job_search`; `adsRepo.createImported` (без фото, цена «за всё», пределы формы), `mine` без `is_imported`. Колонки `ads.is_imported` и `imported_listings.ad_id` — `ALTER … IF NOT EXISTS` в конце `schema.sql`.
- Разбор: `ad_kind`/`ad_category` в промпте и `normalize` (непонятное → `service` / `other`).
- `imports.publish` для `board` → `ads`; `bump`, `remove` (журнал как `ad`), `listPublished` (`live` по `ads.status`) знают `ad_id`; старые `board_post_id` по-прежнему работают.
- Бот: `LISTING_PATHS.board = 'ads'`, все ссылки через `listingUrl`; «✅ Опубликовал в «Объявления»», в меню «🏷 Объявление», справка без «доски». У старой записки ссылка ведёт на `/ads`.
- «Проверка фильтром» ищет и в `ads`; ролики «Объявления дня» (`digestRepo`) берут открытые объявления.
- `/api/home`: `counts` (orders, vacancies, tasks, ads) под кэшем `home:`, заказов на главной 8.
- Тесты: `imports-ads`, `digest-ads`, дополнены `ads-rules`, `ads-repo`, `ads-route`, `extract-parse`, `spam-sweep`, `bot-quiet` — 358/358.

**Сайт**
- `/board` → `/ads` (`Navigate`), `pages/Board.jsx` и стили доски удалены, публичные методы доски убраны из `api.js` (админские остались).
- Шапка (`Navbar.jsx`, `NavMenus.jsx`): разделы слева; справа ✉ со счётчиком, «+ Разместить» (заказ, задача, вакансия, объявление) и меню профиля с первой буквой имени. Бургер убран. 1024 px — одна строка (имя прячется до 1100 px).
- Телефон (до 900 px): `BottomNav.jsx` — Главная · Работа · ＋ · Объявления · Профиль; `Sheet.jsx` — выдвижные панели «Что разместить?» и «Профиль» (с «Сообщениями» и выходом); `WorkSwitcher.jsx` на подработке, вакансиях и бирже. Панель прячется при фокусе в текстовом поле (`body:has(...)`).
- Главная: без пилюли над заголовком, плитки «Что ищете?» со счётчиками, студенты и избранное под ними, соцсети — полосой перед призывом; порядок блоков по плану; ссылки без «→».
- Карточки: общий `ListingCard.jsx` для заказа, вакансии и задачи; у объявления — те же цена, «где и когда» и значки (`CardFlags`). «Офлайн» убран, «Из чатов» добавлен.
- `AdDetail.jsx`: у объявления из группы — «👤 Из открытых чатов», плашка импорта, только WhatsApp.

**Сверх плана**
- Кнопка «Найти» в поиске подработки и вакансий на телефоне сплющивалась в полоску 19 px (старая ошибка) — теперь во всю ширину.
- Скилл `frontend-design` в сессии не подключён как вызываемый — его указания прочитаны из файла плагина и соблюдены (одно яркое место — плитки и красный «＋», без заглавных надписей и «→»).

**Проверка:** бэкенд 358/358, `npm run build` без ошибок; браузер на заглушке API — 375 / 768 / 1280 px, девять страниц без горизонтальной прокрутки, шапка 65/71 px в одну строку, нижняя панель только до 900 px, панели открываются и закрываются после перехода, `/board#p123` → `/ads`, объявление из группы у гостя — плашка и WhatsApp без формы сообщений; ошибок кода в консоли нет (ошибки только от заглушки, которая не знает части путей).

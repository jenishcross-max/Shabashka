// Повтор вакансии из чата (аудит 12 ноября 2026, см. docs/research/2026-11-audit.md):
// за неделю 37% вакансий — тот же номер и тот же заголовок. Каждая становилась
// новой карточкой, и список на сайте превращался в ленту повторов. Теперь повтор
// поднимает старую карточку наверх, а пост в соцсети уходит как раньше — и ведёт
// на неё. Число постов не меняется. PGlite в памяти.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const imports = requireSrc('telegram/imports.js');

const BARISTA = {
  is_listing: true,
  listing_type: 'vacancy',
  title: 'Бариста в кофейню',
  description: 'График 2/2, обучение',
  category: 'Другое',
  city: 'Бишкек',
  work_format: 'offline',
  phone: '+996 700 222 333',
  budget: 30000,
};

test.before(async () => {
  delete process.env.BOT_OWNER_EMAIL;
  await db.query("INSERT INTO categories (name) VALUES ('Другое') ON CONFLICT DO NOTHING");
  await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
     VALUES ('Азамат', 'boss@test.kg', '+996700000001', 'x', true, 'admin')`
  );
});

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
// Окно повтора у create — час (см. DEDUP_WINDOW): прошлый пост «старше часа».
const age = (table, id, interval) => db.query(`UPDATE ${table} SET created_at = NOW() - INTERVAL '${interval}' WHERE id = $1`, [id]);

async function publish(parsed, { ad = false } = {}) {
  const id = await imports.create({ source: 'channel', rawText: parsed.title, parsed, chatId: 1, ad });
  assert.ok(id, 'не отсеяно часовым окном');
  const result = await imports.publish(id);
  await age('imported_listings', id, '2 hours');
  return { id, ...result };
}

test('повтор за неделю поднимает старую карточку — новой нет', async () => {
  const first = await publish(BARISTA);
  await age('vacancies', first.id, '2 days');
  // Тот же номер в другой записи и тот же заголовок другими буквами — тоже повтор.
  const again = await publish({ ...BARISTA, title: 'БАРИСТА в кофейню!', phone: '+996700222333', description: 'Новое' });

  assert.equal(again.type, 'vacancy');
  assert.equal(again.id, first.id, 'пост ведёт на старую карточку');
  assert.equal(again.repeat, true);
  assert.equal((await one("SELECT COUNT(*)::int AS n FROM vacancies WHERE title ILIKE '%бариста%'")).n, 1);
  const card = await one('SELECT bumped_at FROM vacancies WHERE id = $1', [first.id]);
  assert.ok(card.bumped_at, 'карточка поднята наверх ленты');
  const row = await imports.get(again.id === first.id ? (await one('SELECT MAX(id) AS id FROM imported_listings')).id : null);
  assert.equal(row.status, 'published');
  assert.equal(row.vacancy_id, first.id, '«🔎 Найти и снять» снимет ту же карточку');
});

// 12 ноября 2026 на сайте было 43 копии «Курьерлерди жумушка алабыз» с одного
// номера: работодатель постит каждый день, а неделя считалась от создания
// карточки — и раз в неделю появлялась новая. Считаем от последнего поднятия:
// пока повторяет, поднимается одна и та же.
test('повторяет каждый день дольше недели — поднимается всё та же карточка', async () => {
  const base = await one("SELECT id FROM vacancies WHERE title ILIKE '%бариста%'");
  await db.query("UPDATE vacancies SET created_at = NOW() - INTERVAL '20 days', bumped_at = NOW() - INTERVAL '1 day' WHERE id = $1", [base.id]);
  const again = await publish(BARISTA);
  assert.equal(again.id, base.id);
  assert.equal(again.repeat, true);
});

test('неделю тишины, закрытая или другой заголовок — новая карточка', async () => {
  const base = await one("SELECT id FROM vacancies WHERE title ILIKE '%бариста%'");
  await db.query("UPDATE vacancies SET created_at = NOW() - INTERVAL '20 days', bumped_at = NOW() - INTERVAL '8 days' WHERE id = $1", [base.id]);
  const late = await publish(BARISTA);
  assert.notEqual(late.id, base.id, 'неделю не повторял — это уже новая вакансия');

  await db.query("UPDATE vacancies SET status = 'closed' WHERE id = $1", [late.id]);
  const reopened = await publish(BARISTA);
  assert.notEqual(reopened.id, late.id, 'закрытую не поднимаем');

  const cashier = await publish({ ...BARISTA, title: 'Кассир в кофейню' });
  assert.notEqual(cashier.id, reopened.id, 'другая должность у того же работодателя — своя карточка');
});

test('платную рекламу не склеиваем: у неё свои поднятия и снятие', async () => {
  const paid = { ...BARISTA, title: 'Официант в ресторан', phone: '+996700999888' };
  const first = await publish(paid, { ad: true });
  const second = await publish(paid, { ad: true });
  assert.notEqual(second.id, first.id);
  assert.equal(second.repeat, undefined);
});

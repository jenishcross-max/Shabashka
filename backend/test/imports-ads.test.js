// Посты бывшей «Доски» (продам, сдам, свои услуги) бот с октября 2026
// публикует в раздел «Объявления» (src/telegram/imports.js → adsRepo). Здесь —
// публикация, поднятие рекламы, список опубликованного и снятие. PGlite в памяти.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at } = require('./helpers/stub');
const { memoryDb } = require('./helpers/pglite');

const db = memoryDb();
const requireSrc = install({ [at('db/index.js')]: db });
const imports = requireSrc('telegram/imports.js');

const PARSED = {
  is_listing: true,
  listing_type: 'board',
  ad_kind: 'rent_out',
  ad_category: 'housing',
  title: 'Сдаю квартиру',
  description: '2 комнаты, Джал, с мебелью',
  category: 'Другое',
  city: 'Бишкек',
  phone: '+996700111222',
  budget: 25000,
};

let admin;
test.before(async () => {
  delete process.env.BOT_OWNER_EMAIL;
  await db.query("INSERT INTO categories (name) VALUES ('Другое') ON CONFLICT DO NOTHING");
  const { rows } = await db.query(
    `INSERT INTO users (name, email, phone, password_hash, email_verified, role)
     VALUES ('Азамат', 'boss@test.kg', '+996700000001', 'x', true, 'admin') RETURNING *`
  );
  admin = rows[0];
});

const one = async (sql, params) => (await db.query(sql, params)).rows[0];

test('объявление из группы уходит в «Объявления», а не на доску', async () => {
  const id = await imports.create({ source: 'channel', rawText: 'текст', parsed: PARSED, chatId: 1 });
  const result = await imports.publish(id);
  assert.equal(result.type, 'board');

  const ad = await one('SELECT * FROM ads WHERE id = $1', [result.id]);
  assert.equal(ad.is_imported, true);
  assert.equal(ad.user_id, admin.id);
  assert.equal(ad.kind, 'rent_out');
  assert.equal(ad.category, 'housing');
  assert.equal(ad.price, 25000);
  assert.equal(ad.whatsapp_phone, '+996700111222');
  assert.equal(ad.status, 'open');

  const row = await imports.get(id);
  assert.equal(row.status, 'published');
  assert.equal(row.ad_id, ad.id);
  assert.equal(row.board_post_id, null);
  assert.equal((await one('SELECT COUNT(*)::int AS n FROM board_posts')).n, 0);

  // Поднятие платной рекламы — наверх ленты, как у заказа.
  assert.equal(await imports.bump(row), true);
  assert.ok((await one('SELECT bumped_at FROM ads WHERE id = $1', [ad.id])).bumped_at);

  const listed = (await imports.listPublished({ from: 'all', limit: 10, offset: 0 })).find((r) => r.id === id);
  assert.equal(listed.ad_id, ad.id);
  assert.equal(listed.live, true);

  // Снятие через бота: объявления нет, в журнале — как «Объявление».
  await imports.remove(id);
  assert.equal(await one('SELECT id FROM ads WHERE id = $1', [ad.id]), undefined);
  const log = await one("SELECT listing_type, actor FROM moderation_log WHERE listing_id = $1 AND listing_type = 'ad'", [ad.id]);
  assert.equal(log.actor, 'bot');
  assert.equal((await imports.get(id)).status, 'rejected');
});

test('вид и рубрика по умолчанию, если в разборе их нет', async () => {
  const parsed = { ...PARSED, ad_kind: undefined, ad_category: undefined, title: 'Сантехник, все виды работ', budget: null };
  const id = await imports.create({ source: 'channel', rawText: 'другой текст', parsed, chatId: 1 });
  const { id: adId } = await imports.publish(id);
  const ad = await one('SELECT kind, category, price, price_unit FROM ads WHERE id = $1', [adId]);
  assert.deepEqual(ad, { kind: 'service', category: 'other', price: null, price_unit: null });
});

// Повтор за час режется: одно объявление попадает в несколько чатов сразу. Но
// снятую рекламу админ присылает заново осознанно — 26 октября MICHELLE сняли и
// прислали снова, повтор её отсёк, и она вышла «как есть» запиской на доске.
test('снятая реклама повтором не считается, а пост из группы — считается', async () => {
  const parsed = { ...PARSED, listing_type: 'vacancy', title: 'Официанты в кофейню MICHELLE', budget: 65000 };
  const first = await imports.create({ source: 'telegram', rawText: 'MICHELLE', parsed, chatId: 1, ad: true });
  assert.equal(await imports.create({ source: 'telegram', rawText: 'MICHELLE', parsed, chatId: 1, ad: true }), null, 'висит — повтор');

  await imports.reject(first);
  const again = await imports.create({ source: 'telegram', rawText: 'MICHELLE', parsed, chatId: 1, ad: true });
  assert.ok(again, 'сняли и прислали снова — выходит');

  const post = { ...PARSED, listing_type: 'vacancy', title: 'Повар в столовую' };
  const fromGroup = await imports.create({ source: 'channel', rawText: 'повар', parsed: post, chatId: 1 });
  await imports.reject(fromGroup);
  assert.equal(await imports.create({ source: 'channel', rawText: 'повар', parsed: post, chatId: 1 }), null, 'из группы — по-прежнему повтор');
});

// Реклама в группах Telegram (см. src/telegram/adGroups.js). Проверяем то,
// из-за чего аккаунт не должен попасть под ограничение, а рекламодатель — не
// остаться без поста: по одной группе с паузой, в одну группу не чаще раза в
// час, закрытую группу — пропустить и сказать почему, медленный режим и
// FLOOD_WAIT — переждать, PEER_FLOOD — остановиться.
const test = require('node:test');
const assert = require('node:assert/strict');

const { install, at, chat, statsStub } = require('./helpers/stub');

process.env.AD_GROUPS = '@rabota,@jumush,@vac';
delete process.env.TELEGRAM_AD_SESSION_STRING;

// Время двигаем сами: паузы в минуты и перерывы в час не ждём по-настоящему.
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
const later = (ms) => {
  offset += ms;
};
const MIN = 60 * 1000;

// ─── База: ровно те запросы, что делает adGroups, над массивом в памяти

const rows = [];
let seq = 0;
const now = () => new Date(Date.now());
const byId = (id) => rows.find((r) => r.id === id);

async function query(sql, params = []) {
  const q = sql.replace(/\s+/g, ' ').trim();
  const pending = (r) => r.status === 'pending';
  if (q.startsWith('SELECT DISTINCT target')) {
    const targets = rows.filter((r) => r.import_id === params[0] && params[1].includes(r.status)).map((r) => r.target);
    return { rows: [...new Set(targets)].map((target) => ({ target })) };
  }
  if (q.startsWith('SELECT text, media_kind, media_file_id, media_meta FROM ad_group_posts')) {
    const first = rows.filter((r) => r.import_id === params[0]).sort((a, b) => a.id - b.id)[0];
    return { rows: first ? [{ ...first }] : [] };
  }
  if (q.startsWith('SELECT target, MAX(COALESCE')) {
    const last = new Map();
    for (const r of rows) {
      if (!params[0].includes(r.target) || !(pending(r) || r.sent_at)) continue;
      const at = r.sent_at || r.not_before;
      if (!last.has(r.target) || last.get(r.target) < at) last.set(r.target, at);
    }
    return { rows: [...last].map(([target, value]) => ({ target, last: value })) };
  }
  if (q.startsWith('INSERT INTO ad_group_posts')) {
    for (let i = 0; i < params.length; i += 8) {
      const [importId, chatId, target, text, kind, fileId, meta, notBefore] = params.slice(i, i + 8);
      rows.push({
        id: (seq += 1),
        import_id: importId,
        chat_id: chatId,
        target,
        text,
        media_kind: kind,
        media_file_id: fileId,
        media_meta: meta,
        not_before: notBefore,
        status: 'pending',
        attempts: 0,
        created_at: now(),
        sent_at: null,
        note: null,
      });
    }
    return { rows: [] };
  }
  if (q.includes("note = 'устарело")) {
    for (const r of rows) if (pending(r) && r.created_at < new Date(Date.now() - 12 * 60 * MIN)) r.status = 'skipped';
    return { rows: [] };
  }
  if (q.startsWith("SELECT * FROM ad_group_posts WHERE status = 'pending' AND not_before <= NOW()")) {
    const due = rows.filter((r) => pending(r) && r.not_before <= now()).sort((a, b) => a.not_before - b.not_before || a.id - b.id);
    return { rows: due.slice(0, 1).map((r) => ({ ...r })) };
  }
  if (q.startsWith('SELECT MIN(not_before)')) {
    const times = rows.filter(pending).map((r) => r.not_before);
    return { rows: [{ at: times.length ? new Date(Math.min(...times)) : null }] };
  }
  if (q.startsWith("UPDATE ad_group_posts SET status = 'sent'")) {
    const r = byId(params[0]);
    Object.assign(r, { status: 'sent', message_id: params[1], link: params[2], title: params[3], note: params[4], sent_at: now() });
    r.attempts += 1;
    return { rows: [] };
  }
  if (q.startsWith('UPDATE ad_group_posts SET status = $2, note = $3, title')) {
    Object.assign(byId(params[0]), { status: params[1], note: params[2] }, params[3] ? { title: params[3] } : {});
    return { rows: [] };
  }
  if (q.startsWith('UPDATE ad_group_posts SET status = $2, note = $3 WHERE id = $1')) {
    Object.assign(byId(params[0]), { status: params[1], note: params[2] });
    return { rows: [] };
  }
  if (q.startsWith('UPDATE ad_group_posts SET not_before')) {
    const r = byId(params[0]);
    Object.assign(r, { not_before: new Date(Date.now() + Number(params[1])), note: params[2] });
    r.attempts += 1;
    return { rows: [] };
  }
  if (q.startsWith("UPDATE ad_group_posts SET status = 'skipped', note = $2 WHERE status = 'pending' AND target = $1")) {
    for (const r of rows) if (pending(r) && r.target === params[0]) Object.assign(r, { status: 'skipped', note: params[1] });
    return { rows: [] };
  }
  if (q.startsWith("UPDATE ad_group_posts SET status = 'skipped', note = $1 WHERE status = 'pending'")) {
    for (const r of rows) if (pending(r)) Object.assign(r, { status: 'skipped', note: params[0] });
    return { rows: [] };
  }
  if (q.startsWith("UPDATE ad_group_posts SET status = 'skipped', note = 'рекламу сняли'")) {
    const hit = rows.filter((r) => pending(r) && r.import_id === params[0]);
    for (const r of hit) Object.assign(r, { status: 'skipped', note: 'рекламу сняли' });
    return { rows: hit.map((r) => ({ id: r.id })) };
  }
  if (q.startsWith("UPDATE ad_group_posts SET status = 'skipped', note = 'рассылку выключили'")) {
    for (const r of rows) if (pending(r)) Object.assign(r, { status: 'skipped', note: 'рассылку выключили' });
    return { rows: [] };
  }
  if (q.startsWith("UPDATE ad_group_posts SET status = 'skipped', note = 'группу выключили'")) {
    for (const r of rows) if (pending(r) && r.target === params[0]) Object.assign(r, { status: 'skipped', note: 'группу выключили' });
    return { rows: [] };
  }
  if (q.startsWith("SELECT * FROM ad_group_posts WHERE import_id = $1 AND status = 'sent'")) {
    return { rows: rows.filter((r) => r.import_id === params[0] && r.status === 'sent').map((r) => ({ ...r })) };
  }
  if (q.startsWith("UPDATE ad_group_posts SET status = 'deleted'")) {
    byId(params[0]).status = 'deleted';
    return { rows: [] };
  }
  if (q.startsWith('SELECT * FROM ad_group_posts WHERE import_id = $1 ORDER BY id')) {
    return { rows: rows.filter((r) => r.import_id === params[0]).map((r) => ({ ...r })) };
  }
  if (q.startsWith('UPDATE ad_group_posts SET views')) {
    byId(params[0]).views = params[1];
    return { rows: [] };
  }
  if (q.startsWith('SELECT target, MAX(sent_at)')) {
    const out = new Map();
    for (const r of rows) {
      const o = out.get(r.target) || { target: r.target, last_sent: null, pending: 0, week: 0 };
      if (r.sent_at && (!o.last_sent || o.last_sent < r.sent_at)) o.last_sent = r.sent_at;
      if (pending(r)) o.pending += 1;
      if (r.sent_at) o.week += 1;
      out.set(r.target, o);
    }
    return { rows: [...out.values()] };
  }
  throw new Error(`фальшивая база не знает запроса: ${q.slice(0, 90)}`);
}

// ─── Telegram: бот (чтобы сказать админу) и юзер-сессия (чтобы писать)

const tg = chat();
const stats = statsStub();
const groups = install({
  [at('db/index.js')]: { query },
  [at('telegram/api.js')]: tg.api,
  [at('telegram/feedStats.js')]: stats.feedStats,
  // Файл для юзер-сессии. Настоящий GramJS грузится секунды — тесту хватит
  // того же конструктора (name, size, path, buffer).
  [require.resolve('telegram/client/uploads')]: {
    CustomFile: class {
      constructor(name, size, path, buffer) {
        Object.assign(this, { name, size, path, buffer });
      }
    },
  },
})('telegram/adGroups.js');

const ENTITIES = {
  '@rabota': { className: 'Channel', id: 1001, title: 'Работа Бишкек', username: 'rabota' },
  '@jumush': { className: 'Channel', id: 1002, title: 'Жумуш КГ', username: null },
  '@vac': { className: 'Channel', id: 1003, title: 'Вакансии', username: 'vac' },
};

let messageSeq = 0;
const posted = [];
const deleted = [];
const failures = {};
const rpcError = (code, seconds) => Object.assign(new Error(code), { errorMessage: code, seconds });

const client = {
  getEntity: async (target) => ENTITIES[target],
  sendMessage: async (entity, opts) => {
    if (failures[entity.title]) throw failures[entity.title]();
    posted.push({ group: entity.title, text: opts.message, parseMode: opts.parseMode });
    return { id: (messageSeq += 1) };
  },
  sendFile: async (entity, opts) => {
    if (failures[`${entity.title}:file`]) throw failures[`${entity.title}:file`]();
    posted.push({ group: entity.title, text: opts.caption, file: opts.file.name });
    return { id: (messageSeq += 1) };
  },
  deleteMessages: async (entity, ids) => deleted.push({ group: entity.title, ids }),
  getMessages: async () => [],
};

function fresh() {
  rows.length = 0;
  messageSeq = 0;
  posted.length = 0;
  deleted.length = 0;
  tg.clear();
  for (const key of Object.keys(failures)) delete failures[key];
  groups._reset();
  groups._use(client, { id: '42', name: 'Шабашка', username: 'shab' });
  later(3 * 60 * 60 * 1000); // прошлый тест не должен держать перерыв групп
}

const AD = 'Требуются бариста в кофейню, 1500 сом за смену. Ватсап 0500160633';

// Довести очередь до конца: по заходу на каждую паузу.
async function drain(steps = 6, stepMs = 61 * 1000) {
  for (let i = 0; i < steps; i += 1) {
    await groups.tick(Date.now());
    later(stepMs);
  }
}

test('реклама встаёт во все группы и расходится по одной, с паузой', async () => {
  fresh();
  const result = await groups.enqueue({ importId: 5, chatId: 1, text: AD });
  assert.equal(result.queued, 3);
  const times = rows.map((r) => r.not_before.getTime());
  assert.ok(times[1] - times[0] >= 40 * 1000 && times[2] - times[1] >= 40 * 1000, 'между группами — пауза');

  await groups.tick(Date.now());
  await groups.tick(Date.now());
  assert.equal(posted.length, 1, 'второй пост сразу за первым не уходит');
  assert.equal(posted[0].parseMode, false, 'текст без разметки — как написал рекламодатель');

  await drain();
  assert.deepEqual(
    posted.map((p) => p.group),
    ['Работа Бишкек', 'Жумуш КГ', 'Вакансии']
  );
  assert.equal(rows[0].link, 'https://t.me/rabota/1', 'у публичной группы — ссылка по имени');
  assert.equal(rows[1].link, 'https://t.me/c/1002/2', 'у закрытой — через /c/');
  assert.equal(stats.counters['adgrp.ok'], 3);
});

test('та же реклама второй раз не встаёт, а следующая ждёт часового перерыва группы', async () => {
  fresh();
  await groups.enqueue({ importId: 5, chatId: 1, text: AD });
  const again = await groups.enqueue({ importId: 5, chatId: 1, text: AD });
  assert.equal(again.queued, 0);
  assert.match(again.reason, /уже разослана или ждёт очереди/);

  const first = rows.find((r) => r.target === '@vac').not_before.getTime();
  await groups.enqueue({ importId: 6, chatId: 1, text: 'Нужен грузчик на склад, оплата 1000 сом в день, 0700111222' });
  const second = rows.filter((r) => r.target === '@vac')[1].not_before.getTime();
  assert.ok(second - first >= 60 * MIN, 'в одну группу — не чаще раза в час');
});

// Поднятие рекламы (см. adRaises.js): та же реклама в те же группы ещё раз —
// с тем же файлом, а пока прошлый круг не разошёлся, новый не встаёт.
test('поднятие: туда, где реклама уже вышла, она уходит снова, тем же файлом', async () => {
  fresh();
  const media = { kind: 'image', fileId: 'макет', width: 1080, height: 1350 };
  await groups.enqueue({ importId: 5, chatId: 1, text: AD, media });
  const early = await groups.repeat({ importId: 5, chatId: 1, text: 'другой текст' });
  assert.equal(early.queued, 0);
  assert.match(early.reason, /прошлое поднятие ещё не разошлось/);

  await drain();
  assert.equal(posted.length, 3);
  later(2 * 60 * MIN);
  const again = await groups.repeat({ importId: 5, chatId: 1, text: 'другой текст' });
  assert.equal(again.queued, 3);
  const repeats = rows.slice(3);
  assert.ok(repeats.every((r) => r.text === AD && r.media_file_id === 'макет'), 'текст и файл — как в первый раз');
  assert.match(String(repeats[0].media_meta), /1350/);

  // В группы реклама не уходила вовсе — поднятие шлёт её текст.
  const fresh6 = await groups.repeat({ importId: 6, chatId: 1, text: 'Нужен грузчик на склад, оплата 1000 сом в день, 0700111222' });
  assert.equal(fresh6.queued, 3);
});

test('группа, где писать нельзя, выпадает на сутки — с причиной админу', async () => {
  fresh();
  failures['Жумуш КГ'] = () => rpcError('CHAT_WRITE_FORBIDDEN');
  await groups.enqueue({ importId: 5, chatId: 1, text: AD });
  await drain();
  const jumush = rows.find((r) => r.target === '@jumush');
  assert.equal(jumush.status, 'failed');
  assert.match(jumush.note, /только админы/);
  assert.ok(tg.has(/В группу «Жумуш КГ» реклама не уходит/), tg.dump());
  assert.deepEqual(
    posted.map((p) => p.group),
    ['Работа Бишкек', 'Вакансии'],
    'остальные группы своё получили'
  );

  later(2 * 60 * MIN);
  const next = await groups.enqueue({ importId: 6, chatId: 1, text: 'Нужен грузчик на склад, оплата 1000 сом в день, 0700111222' });
  assert.equal(next.queued, 2, 'закрытую группу больше не трогаем');
  const view = await groups.overview();
  assert.match(view.groups[1].broken.reason, /только админы/);

  // Включили руками — снова в деле.
  await groups.toggle(1);
  assert.equal((await groups.overview()).groups[1].broken, null);
});

test('медленный режим и FLOOD_WAIT пережидаются, а не долбятся', async () => {
  fresh();
  let slow = true;
  failures['Работа Бишкек'] = () => {
    if (!slow) return null;
    slow = false;
    return rpcError('SLOWMODE_WAIT_300', 300);
  };
  // failures возвращает фабрику ошибки; null — значит ошибки уже нет.
  const original = client.sendMessage;
  client.sendMessage = async (entity, opts) => {
    const make = failures[entity.title];
    const err = make && make();
    if (err) throw err;
    posted.push({ group: entity.title, text: opts.message });
    return { id: (messageSeq += 1) };
  };
  try {
    await groups.enqueue({ importId: 5, chatId: 1, text: AD });
    await groups.tick(Date.now());
    const rabota = rows.find((r) => r.target === '@rabota');
    assert.equal(rabota.status, 'pending', 'ждёт, а не падает');
    assert.ok(rabota.not_before.getTime() >= Date.now() + 300 * 1000, 'ровно столько, сколько просит группа');

    failures['Жумуш КГ'] = () => rpcError('FLOOD_WAIT_120', 120);
    later(61 * 1000);
    await groups.tick(Date.now());
    later(61 * 1000);
    await groups.tick(Date.now());
    assert.equal(posted.length, 0, 'FLOOD_WAIT держит весь аккаунт, не только группу');

    delete failures['Жумуш КГ'];
    await drain(10);
    assert.deepEqual(posted.map((p) => p.group).sort(), ['Вакансии', 'Жумуш КГ', 'Работа Бишкек']);
  } finally {
    client.sendMessage = original;
  }
});

test('PEER_FLOOD — аккаунт ограничен: очередь снята, админ знает, новое не встаёт', async () => {
  fresh();
  failures['Работа Бишкек'] = () => rpcError('PEER_FLOOD');
  await groups.enqueue({ importId: 5, chatId: 1, text: AD });
  await groups.tick(Date.now());
  assert.ok(rows.every((r) => r.status === 'skipped'), 'вся очередь снята');
  assert.equal(tg.count(/Telegram ограничил аккаунт за рассылку/), 1);
  const next = await groups.enqueue({ importId: 6, chatId: 1, text: AD });
  assert.equal(next.queued, 0);
  assert.match(next.reason, /ограничил аккаунт/);
});

test('картинка уходит с подписью, а где файлы запрещены — текстом', async () => {
  fresh();
  failures['Вакансии:file'] = () => rpcError('CHAT_SEND_PHOTOS_FORBIDDEN');
  await groups.enqueue({ importId: 5, chatId: 1, text: AD, media: { kind: 'image', fileId: 'photo-1' } });
  await drain();
  assert.equal(posted[0].file, 'reklama.jpg');
  assert.equal(posted[0].text, AD, 'подпись — текст рекламы');
  const vac = posted.find((p) => p.group === 'Вакансии');
  assert.equal(vac.file, undefined);
  assert.match(rows.find((r) => r.target === '@vac').note, /файлы в группе запрещены/);
});

test('без текста, при выключенной рассылке и выключенной группе — не встаёт', async () => {
  fresh();
  assert.match((await groups.enqueue({ importId: 5, chatId: 1, text: 'коротко' })).reason, /без текста/);

  await groups.toggle(2);
  assert.equal((await groups.enqueue({ importId: 5, chatId: 1, text: AD })).queued, 2, '@vac выключена');

  await groups.setEnabled(false);
  assert.ok(rows.every((r) => r.status === 'skipped'), 'ждавшее снято');
  assert.match((await groups.enqueue({ importId: 6, chatId: 1, text: AD })).reason, /рассылка выключена/);
});

test('снятие рекламы удаляет вышедшие посты и отменяет ждущие', async () => {
  fresh();
  await groups.enqueue({ importId: 5, chatId: 1, text: AD });
  await groups.tick(Date.now());
  const result = await groups.unpublish(5);
  assert.deepEqual(result, { cancelled: 2, deleted: 1, failed: [] });
  assert.deepEqual(deleted, [{ group: 'Работа Бишкек', ids: [1] }]);
});

test('пустая очередь базу не дёргает, пока не придёт реклама', async () => {
  fresh();
  let queries = 0;
  const counting = async (...args) => {
    queries += 1;
    return query(...args);
  };
  const db = require('../src/db/index.js');
  const original = db.query;
  db.query = counting;
  try {
    await groups.tick(Date.now());
    const idle = queries;
    later(60 * 1000);
    await groups.tick(Date.now());
    await groups.tick(Date.now());
    assert.equal(queries, idle, 'спит, пока очередь пуста');

    await groups.enqueue({ importId: 5, chatId: 1, text: AD });
    await groups.tick(Date.now());
    assert.equal(posted.length, 1, 'новая реклама будит очередь');
  } finally {
    db.query = original;
  }
});

test('своё сообщение в группе — не вакансия со стороны', () => {
  assert.equal(groups.isOwn({ out: true }), true);
  assert.equal(groups.isOwn({ out: false, senderId: 42 }), true, 'отдельный аккаунт для рекламы');
  assert.equal(groups.isOwn({ out: false, senderId: 7 }), false);
});

test.after(() => {
  Date.now = realNow;
});

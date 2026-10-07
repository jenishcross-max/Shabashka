// «🛍 Мои продукты» — то, что админ продаёт сам: пригласительные на свадьбы и
// праздники, приложение Scroll Book и что появится дальше. Не объявления за
// других, а своя реклама, и выходит она своим путём: в Threads и Instagram, по
// кнопке и по расписанию.
//
// У продукта несколько вариантов текста и несколько фото. Каждый выход берёт
// следующий текст и начинает карусель со следующего фото: одинаковый пост раз
// в два дня лента быстро перестаёт показывать, а люди — читать.
//
// Ввод — пошаговый, прямо в чате: «➕ Добавить продукт» → название → тексты и
// фото в любом порядке → «Готово» → расписание. Пока бот ждёт тексты, обычные
// объявления в этот чат не разбираются: всё присланное — продукту. Команда или
// кнопка меню ввод прерывает.
const tg = require('./api');
const store = require('./productStore');
const views = require('./productViews');
const social = require('../social');
const photos = require('../social/photos');
const { clamp } = require('./format');

// Сколько ждём продолжения ввода. Забытое ожидание не должно вечером съесть
// чужое объявление, присланное на разбор.
const INPUT_TTL_MS = 30 * 60 * 1000;
// Альбом приходит пачкой сообщений — отвечаем одним, когда пачка кончилась.
const ACK_DELAY_MS = 1500;
const TICK_MS = 10 * 60 * 1000;
// Просмотры поста в Threads спрашиваем не на каждое нажатие.
const VIEWS_TTL_MS = 10 * 60 * 1000;
const VIEWS_POSTS = 3;

// chatId → { kind: 'name' | 'content', id, fresh, until, texts, photos, full, timer }
const inputs = new Map();

function stopInput(chatId) {
  const state = inputs.get(chatId);
  if (state && state.timer) clearTimeout(state.timer);
  inputs.delete(chatId);
}

function startInput(chatId, state) {
  stopInput(chatId);
  inputs.set(chatId, { ...state, until: Date.now() + INPUT_TTL_MS, texts: 0, photos: 0, full: [] });
}

function inputOf(chatId) {
  const state = inputs.get(chatId);
  if (!state) return null;
  if (state.until < Date.now()) {
    stopInput(chatId);
    return null;
  }
  return state;
}

// Самый крупный размер сжатого фото или картинка, присланная файлом.
function photoOf(message) {
  if (Array.isArray(message.photo) && message.photo.length) {
    return { file_id: message.photo[message.photo.length - 1].file_id, kind: 'photo' };
  }
  if (message.document && String(message.document.mime_type || '').startsWith('image/')) {
    return { file_id: message.document.file_id, kind: 'document' };
  }
  return null;
}

// Каждый выход начинается со следующего фото.
function rotate(list, turn) {
  if (!list.length) return list;
  const k = turn % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

async function sendView(chatId, view) {
  await tg.sendMessage(chatId, view.text, view.extra);
}

function scheduleAck(chatId, state) {
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    state.timer = null;
    const { texts, photos: added, full } = state;
    state.texts = 0;
    state.photos = 0;
    state.full = [];
    try {
      const product = await store.get(state.id);
      if (!product) {
        stopInput(chatId);
        await tg.sendMessage(chatId, 'Этого продукта уже нет — сохранять некуда.');
        return;
      }
      await sendView(chatId, views.savedView({ product, texts, photos: added, full }));
    } catch (err) {
      console.error('[продукты] ответ на присланное:', err.message);
    }
  }, ACK_DELAY_MS);
  if (state.timer.unref) state.timer.unref();
}

// Сообщение в чат, пока бот ждёт ввод для продукта. true — сообщение съедено
// здесь, false — пусть бот разбирает его как обычно.
// isMenuKey — текст кнопки меню внизу экрана (см. menu.KEYS).
async function onMessage(message, { isMenuKey = () => false } = {}) {
  const chatId = message.chat.id;
  const state = inputOf(chatId);
  if (!state) return false;

  const text = (message.text || message.caption || '').trim();
  if (message.text && /^\/cancel\b/i.test(text)) {
    stopInput(chatId);
    await tg.sendMessage(chatId, 'Ок, отменил.');
    return true;
  }
  // Команда или кнопка меню — админ занялся другим. Глотать её как текст
  // продукта нельзя: «/stats» вышел бы постом в Threads.
  if (message.text && (text.startsWith('/') || isMenuKey(text))) {
    stopInput(chatId);
    return false;
  }

  if (state.kind === 'name') {
    if (!message.text || !text) {
      await tg.sendMessage(chatId, 'Пришлите название текстом — например, «Пригласительные».');
      return true;
    }
    const product = await store.create(clamp(text, 60));
    startInput(chatId, { kind: 'content', id: product.id, fresh: true });
    await sendView(chatId, views.contentPrompt(product, { fresh: true }));
    return true;
  }

  const photo = photoOf(message);
  if (!photo && !text) {
    await tg.sendMessage(chatId, 'Сюда — только тексты и фото. Видео и файлы продукту пока не прикрепить.');
    return true;
  }
  state.until = Date.now() + INPUT_TTL_MS;

  if (text) {
    if (text.length > views.TEXT_MAX) {
      await tg.sendMessage(chatId, views.tooLongText(text.length));
    } else if (await store.addText(state.id, text)) {
      state.texts += 1;
    } else if (!state.full.includes('texts')) {
      state.full.push('texts');
    }
  }
  if (photo) {
    if (await store.addPhoto(state.id, photo)) state.photos += 1;
    else if (!state.full.includes('photos')) state.full.push('photos');
  }
  if (state.texts || state.photos || state.full.length) scheduleAck(chatId, state);
  return true;
}

// Просмотры последних постов в Threads — для карточки продукта.
const viewsCache = new Map();
async function threadsViews(posts) {
  const ids = posts
    .filter((p) => p.platform === 'threads' && p.post_id)
    .slice(0, VIEWS_POSTS)
    .map((p) => p.post_id);
  const pairs = await Promise.all(
    ids.map(async (id) => {
      const cached = viewsCache.get(id);
      if (cached && Date.now() - cached.at < VIEWS_TTL_MS) return [id, cached.views];
      try {
        const { views: seen } = await social.threadsInsights(id);
        viewsCache.set(id, { at: Date.now(), views: seen });
        return [id, seen];
      } catch {
        // Нет прав на статистику или Meta не ответила — карточка и без чисел.
        return [id, null];
      }
    })
  );
  return Object.fromEntries(pairs.filter(([, v]) => Number.isFinite(v)));
}

async function listView() {
  return views.listView(await store.list());
}

async function cardView(id) {
  const product = await store.get(id);
  if (!product) return listView();
  const posts = await store.posts(id);
  return views.cardView({ product, posts, views: await threadsViews(posts) });
}

async function sendAlbum(chatId, items) {
  for (const kind of ['photo', 'document']) {
    const group = items.filter((p) => p.kind === kind);
    if (group.length === 1) {
      await tg.call(kind === 'photo' ? 'sendPhoto' : 'sendDocument', { chat_id: chatId, [kind]: group[0].file_id });
    } else if (group.length > 1) {
      await tg.call('sendMediaGroup', { chat_id: chatId, media: group.map((p) => ({ type: kind, media: p.file_id })) });
    }
  }
}

// Ссылка на вышедший пост: из id её не собрать, адрес знает только Meta.
async function linkOf(platform, id) {
  try {
    return platform === 'threads' ? await social.threadsPermalink(id) : await social.instagramPermalink(id);
  } catch {
    return '';
  }
}

// Продукты, которые выходят прямо сейчас. Второе нажатие «Опубликовать», пока
// первый пост ждёт очереди Threads, выложило бы продукт дважды подряд: turn к
// тому моменту уже сдвинут, и claim его пропустил бы.
const publishing = new Set();

// Выход продукта — по кнопке или по расписанию. report — куда писать (чат
// админа). Возвращает, когда обе площадки ответили: между постами в Threads
// до десяти минут, поэтому кнопка сама этого не ждёт.
async function publish(id, report) {
  if (publishing.has(Number(id))) return report({ text: 'Этот продукт уже выходит — дождитесь отчёта.' });
  publishing.add(Number(id));
  try {
    return await publishOnce(id, report);
  } finally {
    publishing.delete(Number(id));
  }
}

async function publishOnce(id, report) {
  const product = await store.get(id);
  if (!product) return report({ text: 'Этого продукта уже нет.' });
  if (!product.texts.length) {
    return report({ text: `У «${tg.esc(product.name)}» нет ни одного текста — публиковать нечего.` });
  }
  // Кнопка в одном процессе и расписание в другом (пока Render переключает
  // версии, живут оба) — выйдет только тот, кто застал turn прежним.
  if (!(await store.claim(product.id, product.turn))) {
    return report({ text: `«${tg.esc(product.name)}» уже выходит — дождитесь отчёта.` });
  }

  const textNo = product.turn % product.texts.length;
  const text = product.texts[textNo];
  const notes = [];

  const buffers = [];
  for (const photo of rotate(product.photos, product.turn)) {
    try {
      buffers.push(await tg.downloadFile(photo.file_id));
    } catch (err) {
      notes.push(`одно фото не скачалось из Telegram (${err.message})`);
    }
  }
  let prepared = { threads: [], instagram: [] };
  try {
    prepared = await photos.prepare(buffers);
  } catch (err) {
    notes.push(`фото не обработались (${err.message}) — в Threads пост уйдёт текстом`);
  }

  const ahead = social.threadsQueued();
  await report({
    text: [
      `🚀 «${tg.esc(product.name)}» — в очередь: текст №${textNo + 1} из ${product.texts.length}, фото: ${prepared.threads.length}.`,
      ahead
        ? `В Threads перед ним ${ahead} — посты выходят раз в ${social.THREADS_INTERVAL_MIN} мин. Отчёт пришлю, когда выйдет.`
        : 'Отчёт пришлю, когда выйдет.',
    ].join('\n'),
  });

  const result = await social.shareProduct({
    text,
    threadsImages: prepared.threads,
    instagramImages: prepared.instagram,
  });

  const outcome = {};
  for (const platform of ['threads', 'instagram']) {
    const r = result[platform];
    const link = r.posted ? await linkOf(platform, r.id) : '';
    outcome[platform] = { result: r, link };
    await store
      .logPost({ productId: product.id, platform, postId: r.posted ? String(r.id) : null, link, textNo, note: r.reason || null })
      .catch((err) => console.error('[продукты] не записал выход:', err.message));
  }
  if (!result.threads.posted && !result.instagram.posted) await store.unclaim(product.id);

  return report(views.publishedView({ product, textNo, threads: outcome.threads, instagram: outcome.instagram, notes }));
}

function publishInBackground(id, report) {
  publish(id, report).catch(async (err) => {
    console.error('[продукты] выход:', err);
    await report({ text: `⚠️ Продукт не вышел: ${tg.esc(err.message)}` }).catch(() => {});
  });
}

// Кнопки раздела: callback_data «pr:<что>:<id>:<аргумент>».
// show — как бот показывает экраны: правит сообщение с кнопкой или шлёт новое.
async function onCallback(query, [sub, rawId, arg], { show }) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const id = Number(rawId);
  const answer = (text) => tg.answerCallbackQuery(query.id, text);
  const toChat = (view) => tg.sendMessage(chatId, view.text, view.extra);

  switch (sub) {
    case 'new':
      await answer();
      startInput(chatId, { kind: 'name' });
      return sendView(chatId, views.namePrompt());

    case 'cancel':
      stopInput(chatId);
      await answer('Отменил');
      return show(chatId, await listView(), messageId);

    case 'open':
      await answer();
      return show(chatId, await cardView(id), messageId);

    case 'add': {
      const product = await store.get(id);
      if (!product) return answer('Этого продукта уже нет');
      await answer();
      startInput(chatId, { kind: 'content', id });
      return sendView(chatId, views.contentPrompt(product));
    }

    case 'done': {
      const state = inputOf(chatId);
      const fresh = Boolean(state && state.fresh && state.id === id);
      stopInput(chatId);
      const product = await store.get(id);
      if (!product) return answer('Этого продукта уже нет');
      await answer();
      return show(chatId, fresh ? views.scheduleView(product) : await cardView(id), messageId);
    }

    case 'pub':
      await answer('Публикую');
      return publishInBackground(id, toChat);

    case 'txt':
    case 'pho':
    case 'sch':
    case 'del': {
      const product = await store.get(id);
      if (!product) return answer('Этого продукта уже нет');
      await answer();
      const view = {
        txt: () => views.textsView(product),
        pho: () => views.photosView(product, store.MAX_PHOTOS),
        sch: () => views.scheduleView(product),
        del: () => views.confirmDeleteView(product),
      }[sub]();
      return show(chatId, view, messageId);
    }

    case 'delt':
    case 'delp': {
      const remove = sub === 'delt' ? store.removeText : store.removePhoto;
      const product = await remove(id, Number(arg));
      if (!product) return answer('Этого продукта уже нет');
      await answer(sub === 'delt' ? 'Текст убран' : 'Фото убрано');
      return show(chatId, sub === 'delt' ? views.textsView(product) : views.photosView(product, store.MAX_PHOTOS), messageId);
    }

    case 'show': {
      const product = await store.get(id);
      if (!product || !product.photos.length) return answer('Фото нет');
      await answer();
      return sendAlbum(chatId, product.photos);
    }

    case 'every': {
      const days = Number(arg) || 0;
      const product = await store.setEvery(id, days);
      if (!product) return answer('Этого продукта уже нет');
      await answer(views.everyText(days));
      return show(chatId, await cardView(id), messageId);
    }

    case 'pause': {
      const current = await store.get(id);
      if (!current) return answer('Этого продукта уже нет');
      await store.setPaused(id, !current.paused);
      await answer(current.paused ? 'Снова по расписанию' : 'На паузе — сам выходить не будет');
      return show(chatId, await cardView(id), messageId);
    }

    case 'delok':
      await store.remove(id);
      stopInput(chatId);
      await answer('Удалено');
      return show(chatId, await listView(), messageId);

    default:
      return answer();
  }
}

// Час по Бишкеку: Render живёт по UTC.
function bishkekHour(now) {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bishkek', hour: '2-digit', hourCycle: 'h23' }).format(now)
  );
}

// Расписание: раз в десять минут — один продукт, чей срок подошёл. По одному,
// а не всех разом: три продукта подряд в ленте — это уже поток рекламы.
let busy = false;
async function tick(report, now = Date.now()) {
  if (busy) return;
  const hour = bishkekHour(now);
  if (hour < views.DAY_FROM || hour >= views.DAY_TO) return;
  busy = true;
  try {
    const product = await store.due();
    if (product) await publish(product.id, report);
  } catch (err) {
    console.error('[продукты] расписание:', err.message);
  } finally {
    busy = false;
  }
}

// report — куда писать о выходах по расписанию: чат админа.
function start({ report }) {
  const run = () => tick(report);
  setInterval(run, TICK_MS).unref();
  setTimeout(run, 60 * 1000).unref();
}

module.exports = { onMessage, onCallback, listView, publish, tick, start };

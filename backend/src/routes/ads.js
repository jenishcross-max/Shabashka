const express = require('express');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { reportLimiter, adLimiter, photoLimiter } = require('../rateLimit');
const asyncHandler = require('../asyncHandler');
const reportsRepo = require('../reportsRepo');
const { canCreateListing } = require('../emailGate');
const { invalidate } = require('../cache');
const bump = require('../bump');
const storage = require('../photoStorage');
const { withPhotoUrls } = require('../adsView');
const repo = require('../adsRepo');
const rules = require('../adsRules');

// Раздел «Объявления»: сдам, сниму, продам, куплю, отдам даром (правила — в
// adsRules.js, запросы — в adsRepo.js). Тот же API потом возьмёт
// Android-приложение, поэтому коды видов и рубрик — латиницей, а подписи
// живут на клиенте.
const router = express.Router();

const NOT_FOUND = { error: 'Объявление не найдено' };

function toId(raw) {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Цена из адреса: «100 000» и «100000» одно и то же, мусор — как будто фильтра нет.
function toNumber(raw) {
  const s = String(raw ?? '').replace(/\s/g, '');
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// Объявление из адреса; null — уже ответили 404.
async function loadAd(req, res) {
  const id = toId(req.params.id);
  const ad = id && (await repo.get(id));
  if (!ad) {
    res.status(404).json(NOT_FOUND);
    return null;
  }
  return ad;
}

const refuse = (res, blocker) => res.status(blocker.status).json({ error: blocker.error });

// Файлы из хранилища убираем без ожидания: объявление уже сохранено, и сбой
// Supabase не повод отвечать автору ошибкой. Лишний файл в хранилище дешевле.
function dropPhotos(paths) {
  if (!paths.length) return;
  storage.remove(paths).catch((err) => console.error('Не удалось удалить фото объявления:', err.message));
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Сверху — тоже предел: page=1e18 дал бы OFFSET за пределами bigint и 500.
    const page = Math.min(10000, Math.max(1, parseInt(req.query.page, 10) || 1));
    const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const { ads, total } = await repo.list({
      kind: rules.KINDS.includes(req.query.kind) ? req.query.kind : undefined,
      category: rules.CATEGORIES.includes(req.query.category) ? req.query.category : undefined,
      city: String(req.query.city || '').trim().slice(0, 60),
      q: String(req.query.q || '').trim().slice(0, 100),
      priceMin: toNumber(req.query.priceMin),
      priceMax: toNumber(req.query.priceMax),
      sort: req.query.sort,
      page,
      limit,
    });
    res.json({ ads: ads.map(withPhotoUrls), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  })
);

// '/mine', '/batch' и '/photos' — до '/:id', иначе Express принял бы их за id.
router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ ads: (await repo.mine(req.user.id)).map(withPhotoUrls) });
  })
);

// Пакетная выборка для избранного — не увеличивает счётчик просмотров.
router.get(
  '/batch',
  asyncHandler(async (req, res) => {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 100);
    res.json({ ads: (await repo.batch(ids)).map(withPhotoUrls) });
  })
);

// Одноразовая ссылка на загрузку одного фото. Путь выбирает сервер и кладёт его
// в папку автора — по ней adsRules.js потом отличает свои фото от чужих.
router.post(
  '/photos',
  requireAuth,
  photoLimiter,
  asyncHandler(async (req, res) => {
    if (!storage.configured) {
      return res
        .status(503)
        .json({ error: 'Загрузка фото пока не настроена — подайте объявление без фото, их можно будет добавить позже' });
    }
    const path = storage.newPath(req.user.id);
    res.status(201).json({ path, upload_url: await storage.signUpload(path), url: storage.publicUrl(path) });
  })
);

// Снятое модератором видит только автор: ему важно понять, куда оно делось, а
// остальным по старой ссылке — просто «не найдено».
router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const ad = await loadAd(req, res);
    if (!ad) return;
    const isOwner = req.user?.id === ad.user_id;
    if (ad.status === 'removed' && !isOwner) return res.status(404).json(NOT_FOUND);
    if (!isOwner) await repo.addView(ad.id);
    res.json({ ad: withPhotoUrls(ad) });
  })
);

router.post(
  '/',
  requireAuth,
  adLimiter,
  asyncHandler(async (req, res) => {
    if (!(await canCreateListing(req.user.id, req.user.email_verified))) {
      return res
        .status(403)
        .json({ error: 'Подтвердите email, чтобы разместить больше одного объявления', code: 'EMAIL_NOT_VERIFIED' });
    }
    const { errors, result } = rules.validateAd(req.body || {}, { userId: req.user.id });
    if (errors.length) return res.status(400).json({ error: errors[0] });

    const id = await repo.create(req.user.id, result);
    invalidate('home:'); // свежее объявление сразу видно в блоке на главной
    res.status(201).json({ ad: withPhotoUrls(await repo.get(id)) });
  })
);

router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ad = await loadAd(req, res);
    if (!ad) return;
    const blocker = rules.ownerBlocker(ad, req.user.id, 'edit');
    if (blocker) return refuse(res, blocker);

    const { errors, result } = rules.validateAd(req.body || {}, { userId: req.user.id });
    if (errors.length) return res.status(400).json({ error: errors[0] });
    if (!(await repo.update(ad.id, result))) {
      return res.status(409).json({ error: 'Объявление снято модератором — обновите страницу' });
    }
    dropPhotos(ad.photos.filter((path) => !result.photos.includes(path)));
    invalidate('home:');
    res.json({ ad: withPhotoUrls(await repo.get(ad.id)) });
  })
);

// Закрыть (продано, сдано) и открыть снова. Если статус успел смениться между
// чтением и записью (вторая вкладка, модератор) — 409.
const STEPS = { close: ['open', 'closed'], reopen: ['closed', 'open'] };

for (const [action, [from, to]] of Object.entries(STEPS)) {
  router.post(
    `/:id/${action}`,
    requireAuth,
    asyncHandler(async (req, res) => {
      const ad = await loadAd(req, res);
      if (!ad) return;
      const blocker = rules.ownerBlocker(ad, req.user.id, action);
      if (blocker) return refuse(res, blocker);
      if (!(await repo.setStatus(ad.id, req.user.id, from, to))) {
        return res.status(409).json({ error: 'Статус объявления уже изменился — обновите страницу' });
      }
      invalidate('home:');
      res.json({ ad: withPhotoUrls(await repo.get(ad.id)) });
    })
  );
}

// Поднять в ленте — раз в сутки, как заказы (см. bump.js).
router.post(
  '/:id/bump',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ad = await loadAd(req, res);
    if (!ad) return;
    const blocker = rules.ownerBlocker(ad, req.user.id, 'bump');
    if (blocker) return refuse(res, blocker);
    const early = bump.tooSoon(ad);
    if (early) return res.status(429).json(early);

    await repo.bump(ad.id);
    invalidate('home:');
    res.json({ ad: withPhotoUrls(await repo.get(ad.id)) });
  })
);

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ad = await loadAd(req, res);
    if (!ad) return;
    const blocker = rules.ownerBlocker(ad, req.user.id, 'delete');
    if (blocker) return refuse(res, blocker);
    const photos = await repo.remove(ad.id, req.user.id);
    if (!photos) return res.status(404).json(NOT_FOUND);
    dropPhotos(photos);
    invalidate('home:');
    res.status(204).end();
  })
);

// Жалоба — от всех и без аккаунта, как у заказов: обманывают чаще всего того,
// кто на сайте не зарегистрирован.
router.post(
  '/:id/report',
  reportLimiter,
  asyncHandler(async (req, res) => {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Укажите причину жалобы' });
    const id = toId(req.params.id);
    const reportId = id && (await reportsRepo.create({ listingType: 'ad', listingId: id, reason }));
    if (!reportId) return res.status(404).json(NOT_FOUND);
    res.status(201).json({ ok: true });
  })
);

module.exports = router;

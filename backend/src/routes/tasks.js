const express = require('express');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { reportLimiter, taskLimiter, offerLimiter } = require('../rateLimit');
const asyncHandler = require('../asyncHandler');
const categoriesRepo = require('../categoriesRepo');
const reportsRepo = require('../reportsRepo');
const { canCreateListing } = require('../emailGate');
const { invalidate } = require('../cache');
const repo = require('../tasksRepo');
const exchange = require('../exchange');
const taskEvents = require('../taskEvents');

// Биржа услуг: задачи и отклики (см. exchange.js — правила, tasksRepo.js —
// запросы). Тот же API потом использует Android-приложение, поэтому ответы
// самодостаточны: состояние отклика приходит словом, а не выводится на клиенте.
const router = express.Router();

const NOT_FOUND = { error: 'Задача не найдена' };

function toId(raw) {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Задача из адреса; null — уже ответили 404.
async function loadTask(req, res) {
  const id = toId(req.params.id);
  const task = id && (await repo.get(id));
  if (!task) {
    res.status(404).json(NOT_FOUND);
    return null;
  }
  return task;
}

const refuse = (res, blocker) => res.status(blocker.status).json({ error: blocker.error });
const withState = (offer, taskStatus) => offer && { ...offer, state: exchange.offerState(offer.status, taskStatus) };

router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Сверху — тоже предел: page=1e18 дал бы OFFSET за пределами bigint и 500.
    const page = Math.min(10000, Math.max(1, parseInt(req.query.page, 10) || 1));
    const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const { tasks, total } = await repo.list({
      category: String(req.query.category || '').trim(),
      city: String(req.query.city || '').trim().slice(0, 60),
      q: String(req.query.q || '').trim().slice(0, 100),
      page,
      limit,
    });
    res.json({ tasks, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  })
);

// '/mine' и '/my-offers' — до '/:id', иначе Express принял бы их за id.
router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ tasks: await repo.mine(req.user.id) });
  })
);

router.get(
  '/my-offers',
  requireAuth,
  asyncHandler(async (req, res) => {
    const offers = (await repo.myOffers(req.user.id)).map((o) => withState(o, o.task_status));
    res.json({ offers });
  })
);

// Задача. Вошедшему — его отклик; заказчику и выбранному исполнителю — их
// переписка. Отклики целиком здесь не отдаются: их видит только заказчик
// через /:id/offers.
router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    const me = req.user?.id;
    const isOwner = me === task.user_id;
    if (!isOwner) await repo.addView(task.id);

    const myOffer = me && !isOwner ? await repo.offerOf(task.id, me) : null;
    const involved = isOwner || myOffer?.status === 'accepted';
    res.json({
      task,
      my_offer: withState(myOffer, task.status),
      conversation_id: involved ? await repo.chosenChat(task.id) : null,
    });
  })
);

router.post(
  '/',
  requireAuth,
  taskLimiter,
  asyncHandler(async (req, res) => {
    if (!(await canCreateListing(req.user.id, req.user.email_verified))) {
      return res
        .status(403)
        .json({ error: 'Подтвердите email, чтобы разместить больше одного объявления', code: 'EMAIL_NOT_VERIFIED' });
    }
    const categories = await categoriesRepo.listNames();
    const { errors, result } = exchange.validateTask(req.body || {}, { categories });
    if (errors.length) return res.status(400).json({ error: errors[0] });

    const id = await repo.create(req.user.id, result);
    invalidate('home:'); // свежая задача сразу видна в блоке биржи на главной
    const task = await repo.get(id);
    taskEvents.created(task); // бот предложит админу раздать её (см. telegram/taskShare.js)
    res.status(201).json({ task });
  })
);

router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    const blocker = exchange.ownerBlocker(task, req.user.id, 'edit');
    if (blocker) return refuse(res, blocker);

    const categories = await categoriesRepo.listNames();
    const { errors, result } = exchange.validateTask(req.body || {}, { categories, partial: true });
    if (errors.length) return res.status(400).json({ error: errors[0] });
    if (!Object.keys(result).length) return res.status(400).json({ error: 'Нечего обновлять' });
    if (!(await repo.update(task.id, result))) {
      return res.status(409).json({ error: 'Задачу можно править, пока исполнитель не выбран' });
    }
    invalidate('home:');
    res.json({ task: await repo.get(task.id) });
  })
);

// Переходы, которые делает только заказчик. Если между чтением и записью статус
// успел смениться (вторая вкладка), запись не пройдёт — отвечаем 409.
const OWNER_STEPS = {
  cancel: (task) => repo.setStatus(task.id, task.user_id, ['open', 'assigned'], 'cancelled'),
  done: (task) => repo.setStatus(task.id, task.user_id, ['assigned'], 'done'),
  unassign: (task) => repo.unassign(task.id, task.user_id),
};

for (const [action, step] of Object.entries(OWNER_STEPS)) {
  router.post(
    `/:id/${action}`,
    requireAuth,
    asyncHandler(async (req, res) => {
      const task = await loadTask(req, res);
      if (!task) return;
      const blocker = exchange.ownerBlocker(task, req.user.id, action);
      if (blocker) return refuse(res, blocker);
      if (!(await step(task))) {
        return res.status(409).json({ error: 'Статус задачи уже изменился — обновите страницу' });
      }
      invalidate('home:');
      res.json({ task: await repo.get(task.id) });
    })
  );
}

router.get(
  '/:id/offers',
  requireAuth,
  asyncHandler(async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    if (task.user_id !== req.user.id) return res.status(403).json({ error: 'Отклики видит только автор задачи' });
    res.json({ offers: await repo.offersForOwner(task.id) });
  })
);

// Откликнуться или поправить свой отклик — один адрес на оба случая.
router.post(
  '/:id/offers',
  requireAuth,
  offerLimiter,
  asyncHandler(async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    const blocker = exchange.offerBlocker(task, req.user.id, await repo.offerOf(task.id, req.user.id));
    if (blocker) return refuse(res, blocker);

    const { errors, result } = exchange.validateOffer(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors[0] });
    const offer = await repo.saveOffer(task.id, req.user.id, result);
    if (!offer) return res.status(409).json({ error: 'Задача уже не принимает отклики' });
    res.status(201).json({ offer: withState(offer, 'open') });
  })
);

router.post(
  '/:id/offers/withdraw',
  requireAuth,
  asyncHandler(async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    const blocker = exchange.withdrawBlocker(task, await repo.offerOf(task.id, req.user.id));
    if (blocker) return refuse(res, blocker);
    const offer = await repo.withdrawOffer(task.id, req.user.id);
    if (!offer) return res.status(409).json({ error: 'Исполнитель уже выбран' });
    res.json({ offer: withState(offer, task.status) });
  })
);

// Выбрать исполнителя: задача закрывается для откликов, с выбранным открывается
// переписка — первое сообщение уходит от имени заказчика тем же запросом, что и
// выбор (см. tasksRepo.accept). Текст собираем заранее, по отклику до выбора.
router.post(
  '/:id/offers/:offerId/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    const blocker = exchange.ownerBlocker(task, req.user.id, 'accept');
    if (blocker) return refuse(res, blocker);

    const offerId = toId(req.params.offerId);
    const chosen = offerId && (await repo.offerById(offerId));
    if (!chosen || chosen.task_id !== task.id) return res.status(404).json({ error: 'Отклик не найден' });
    const offer = await repo.accept(task.id, req.user.id, chosen.id, exchange.chosenMessage(task, chosen));
    if (!offer) return res.status(409).json({ error: 'Этот отклик уже нельзя выбрать — обновите страницу' });

    invalidate('home:');
    res.json({ task: await repo.get(task.id), offer, conversation_id: offer.conversation_id });
  })
);

// Жалоба на задачу — от всех и без аккаунта, как у заказов.
router.post(
  '/:id/report',
  reportLimiter,
  asyncHandler(async (req, res) => {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Укажите причину жалобы' });
    const id = toId(req.params.id);
    const reportId = id && (await reportsRepo.create({ listingType: 'task', listingId: id, reason }));
    if (!reportId) return res.status(404).json(NOT_FOUND);
    res.status(201).json({ ok: true });
  })
);

// Жалоба на отклик — только от заказчика: отклики целиком видит лишь он, а
// просьбы о предоплате и спам приходят именно туда.
router.post(
  '/:id/offers/:offerId/report',
  requireAuth,
  reportLimiter,
  asyncHandler(async (req, res) => {
    const task = await loadTask(req, res);
    if (!task) return;
    if (task.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Пожаловаться на отклик может только автор задачи' });
    }
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Укажите причину жалобы' });
    const offerId = toId(req.params.offerId);
    const offer = offerId && (await repo.offerById(offerId));
    if (!offer || offer.task_id !== task.id) return res.status(404).json({ error: 'Отклик не найден' });

    await reportsRepo.create({ listingType: 'offer', listingId: offer.id, reason });
    res.status(201).json({ ok: true });
  })
);

module.exports = router;

const crypto = require('crypto');
const express = require('express');
const dm = require('../dm');
const texts = require('../dm/texts');

// Мост между расширением в Chrome владельца и ИИ-продавцом (см. src/dm и
// tools/threads-dm). Снаружи сюда не ходит никто, кроме расширения, поэтому
// всё закрыто одним ключом — DM_BRIDGE_KEY, он же вписан в настройки
// расширения. Без ключа мост выключен целиком: иначе любой, кто узнал адрес,
// мог бы от имени Шабашки получать номер МБанка и слать «чеки».

const router = express.Router();

// Сравнение за одно и то же время, какой бы ни была ошибка в ключе: по времени
// ответа ключ иначе можно подбирать посимвольно. Длину сравниваем в байтах —
// timingSafeEqual на буферах разной длины падает.
function keyMatches(given) {
  const want = Buffer.from(String(process.env.DM_BRIDGE_KEY || ''));
  const got = Buffer.from(String(given || ''));
  if (!want.length || got.length !== want.length) return false;
  return crypto.timingSafeEqual(got, want);
}

router.use((req, res, next) => {
  if (!process.env.DM_BRIDGE_KEY) {
    return res.status(503).json({ error: 'Автоответчик выключен: в Render не задан DM_BRIDGE_KEY' });
  }
  if (!keyMatches(req.get('x-bridge-key'))) return res.status(401).json({ error: 'Неверный ключ' });
  return next();
});

// Скриншот чека приходит картинкой в base64 — общий лимит express.json
// (100 КБ) его не пропустит. Разбираем тело только после ключа: двенадцать
// мегабайт от кого попало бесплатный Render держать в памяти не должен.
router.use(express.json({ limit: '12mb' }));

// Проверка связи из настроек расширения: ключ подошёл, номер для оплаты есть.
router.get('/ping', (_req, res) => {
  res.json({ ok: true, mbank: Boolean(texts.mbank().number), price: texts.PRICE });
});

router.get('/peers', async (_req, res, next) => {
  try {
    res.json({ peers: await dm.peers() });
  } catch (err) {
    next(err);
  }
});

router.post('/threads/sync', async (req, res, next) => {
  try {
    const { peer, name, request, messages } = req.body || {};
    res.json(await dm.sync({ peer, name, request: Boolean(request), messages }));
  } catch (err) {
    next(err);
  }
});

router.post('/threads/requeue', async (req, res, next) => {
  try {
    const { peer, texts } = req.body || {};
    res.json({ queued: await dm.requeue(peer, texts) });
  } catch (err) {
    next(err);
  }
});

router.get('/outbox', async (_req, res, next) => {
  try {
    res.json({ messages: await dm.outbox() });
  } catch (err) {
    next(err);
  }
});

router.post('/outbox/:id/sent', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Неверный id' });
  try {
    await dm.sent(id);
    return res.json({ ok: true });
  } catch (err) {
    return next(err);
  }
});

// Расширение не нашло на странице то, что ищет (Threads поменял вёрстку), —
// пишет сюда, чтобы это было видно в логах Render, а не только в консоли Chrome.
router.post('/log', (req, res) => {
  const { level, message } = req.body || {};
  console.log(`[директ: расширение] ${level === 'error' ? '⚠️ ' : ''}${String(message || '').slice(0, 500)}`);
  res.json({ ok: true });
});

module.exports = router;

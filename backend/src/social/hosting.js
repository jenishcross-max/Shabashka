const express = require('express');

// Instagram не принимает загрузку файлом — он сам приходит за роликом по ссылке.
// Значит, mp4 надо на несколько минут выложить наружу. Держим в памяти: ролик
// весит пару сотен килобайт, а на Render диск всё равно эфемерный.
const TTL_MS = 20 * 60 * 1000;
const files = new Map();

function sweep() {
  const now = Date.now();
  for (const [name, entry] of files) {
    if (entry.expiresAt <= now) files.delete(name);
  }
}

function put(name, buffer) {
  sweep();
  files.set(name, { buffer, expiresAt: Date.now() + TTL_MS });
  return name;
}

const router = express.Router();

router.get('/video/:name', (req, res) => {
  const entry = files.get(req.params.name);
  if (!entry || entry.expiresAt <= Date.now()) return res.sendStatus(404);

  const { buffer } = entry;
  res.set({
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  });

  // Загрузчик Instagram иногда качает файл по кускам — без поддержки Range он
  // получил бы весь файл на запрос куска и счёл ответ некорректным.
  const range = req.get('Range');
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (match) {
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), buffer.length - 1) : buffer.length - 1;
    if (start > end) return res.sendStatus(416);
    res.status(206).set({
      'Content-Range': `bytes ${start}-${end}/${buffer.length}`,
      'Content-Length': end - start + 1,
    });
    return res.end(buffer.subarray(start, end + 1));
  }

  res.set('Content-Length', buffer.length);
  return res.end(buffer);
});

module.exports = { put, router };

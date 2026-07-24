const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

const uploadsDir = path.join(__dirname, '..', 'uploads', 'orders');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Файл сначала попадает в память — на диск пишем уже сжатую sharp'ом версию
const storage = multer.memoryStorage();

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error('Поддерживаются только изображения JPEG, PNG или WebP'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// Приводим загруженное фото к единому формату: макс. ширина 1200px, JPEG, качество 80 —
// экономит место на диске и трафик при отдаче карточек заказов.
async function processImage(req, res, next) {
  if (!req.file) return next();
  try {
    const filename = `${crypto.randomBytes(16).toString('hex')}.jpg`;
    const outPath = path.join(uploadsDir, filename);
    await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(outPath);
    req.file.filename = filename;
    req.file.path = outPath;
    next();
  } catch {
    res.status(400).json({ error: 'Не удалось обработать изображение' });
  }
}

module.exports = { upload, uploadsDir, processImage };

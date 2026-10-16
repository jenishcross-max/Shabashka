const storage = require('./photoStorage');

// Фото объявления в ответах API — пары «путь + ссылка». В базе лежат только
// пути: адрес хранилища может смениться, а пути — нет. Путь нужен форме правки
// (она шлёт его обратно), ссылка — показу. Отдельным модулем, потому что
// объявления отдают и /api/ads, и главная.
function withPhotoUrls(ad) {
  return ad && { ...ad, photos: (ad.photos || []).map((path) => ({ path, url: storage.publicUrl(path) })) };
}

module.exports = { withPhotoUrls };

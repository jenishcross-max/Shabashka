// Фото с телефона весит 3–8 МБ, а в ленте его показывают шириной в карточку.
// Ужимаем до 1280 px по длинной стороне и JPEG ~0.82 прямо в браузере: выходит
// 150–250 КБ — грузится по мобильной сети за секунды, и бесплатного гигабайта
// в хранилище хватает на тысячи фото. Поворот с телефона учитываем
// (imageOrientation), иначе снимки «лёжа на боку» так и оставались бы лежать.
const MAX_SIDE = 1280;
const QUALITY = 0.82;

async function decode(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // старый Safari не понимает второй аргумент — пробуем через <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function shrinkPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Это не фото — выберите картинку');
  let image;
  try {
    image = await decode(file);
  } catch {
    throw new Error('Не удалось открыть фото — попробуйте другое (JPEG или PNG)');
  }
  const width = image.width;
  const height = image.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  // У PNG с прозрачностью фон стал бы чёрным — подкладываем белый.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (image.close) image.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('Не удалось подготовить фото — попробуйте другое');
  return blob;
}

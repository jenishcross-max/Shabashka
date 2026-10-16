const crypto = require('crypto');

// Фото объявлений — в Supabase Storage, в публичном хранилище «ads». База уже
// живёт в Supabase, а картинки оттуда отдаются напрямую, без Render: бесплатный
// бэкенд засыпает, и лента с фото через него открывалась бы серыми квадратами.
//
// Загружает браузер, а не бэкенд: бэкенд только выдаёт одноразовую ссылку на
// конкретный путь в папке автора (см. routes/ads.js), и через Render не идёт ни
// одного мегабайта. Размер файла и тип ограничены в настройках самого хранилища.
//
// SDK не берём: нужны три запроса, а SDK тянет за собой клиент всей платформы.
// Пока SUPABASE_URL и SUPABASE_SERVICE_KEY не заданы, хранилище выключено:
// объявления работают, просто без загрузки фото.
const BUCKET = 'ads';

function createStorage({ url, key, fetch = globalThis.fetch } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const secret = String(key || '');
  const configured = Boolean(base && secret);

  // Новые секретные ключи (sb_secret_…) Supabase принимает только в apikey, а
  // старый service_role — это JWT, его ждут ещё и в Authorization.
  const headers = () => ({
    apikey: secret,
    ...(secret.startsWith('eyJ') ? { Authorization: `Bearer ${secret}` } : {}),
    'Content-Type': 'application/json',
  });

  async function call(path, method, body) {
    const res = await fetch(`${base}/storage/v1${path}`, { method, headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Supabase Storage ответил ${res.status}: ${await res.text().catch(() => '')}`);
    return res.json();
  }

  return {
    configured,

    // u<id>/<uuid>.jpg: папка автора — чтобы правило «только свои фото» в
    // adsRules.js проверялось по одному пути, без похода в хранилище.
    newPath: (userId) => `u${Number(userId)}/${crypto.randomUUID()}.jpg`,

    publicUrl: (path) => (configured ? `${base}/storage/v1/object/public/${BUCKET}/${path}` : null),

    // Полный адрес для PUT из браузера; ссылка живёт два часа и годится для
    // одного файла по одному пути.
    async signUpload(path) {
      const data = await call(`/object/upload/sign/${BUCKET}/${path}`, 'POST', {});
      return `${base}/storage/v1${data.url}`;
    },

    async remove(paths) {
      if (!configured || !paths.length) return;
      await call(`/object/${BUCKET}`, 'DELETE', { prefixes: paths });
    },
  };
}

module.exports = {
  ...createStorage({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY }),
  createStorage,
};

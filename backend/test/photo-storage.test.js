// Хранилище фото объявлений (src/photoStorage.js) — REST Supabase Storage без SDK.
// В сеть тест не ходит: fetch подставной и записывает, что у него попросили.
const test = require('node:test');
const assert = require('node:assert/strict');

const { createStorage } = require('../src/photoStorage');

const URL = 'https://abc.supabase.co';
const PATH = 'u7/123e4567-e89b-42d3-a456-426614174000.jpg';

function fakeFetch(reply = { status: 200, body: {} }) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, ...init, body: init.body && JSON.parse(init.body) });
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
      text: async () => JSON.stringify(reply.body),
    };
  };
  return { fetch, calls };
}

test('без адреса или ключа хранилище выключено и в сеть не ходит', async () => {
  const { fetch, calls } = fakeFetch();
  for (const storage of [createStorage({ url: '', key: 'k', fetch }), createStorage({ url: URL, key: '', fetch })]) {
    assert.equal(storage.configured, false);
    assert.equal(storage.publicUrl(PATH), null);
    await storage.remove([PATH]);
  }
  assert.equal(calls.length, 0);
});

test('путь для загрузки — в папке пользователя, каждый раз новый', () => {
  const storage = createStorage({ url: URL, key: 'k', fetch: fakeFetch().fetch });
  const a = storage.newPath(7);
  assert.match(a, /^u7\/[0-9a-f-]{36}\.jpg$/);
  assert.notEqual(a, storage.newPath(7));
});

test('публичная ссылка на фото — без лишнего слэша в адресе', () => {
  const storage = createStorage({ url: `${URL}/`, key: 'k', fetch: fakeFetch().fetch });
  assert.equal(storage.publicUrl(PATH), `${URL}/storage/v1/object/public/ads/${PATH}`);
});

test('одноразовая ссылка: POST на upload/sign, в ответе — полный адрес с токеном', async () => {
  const { fetch, calls } = fakeFetch({ status: 200, body: { url: `/object/upload/sign/ads/${PATH}?token=t1` } });
  const storage = createStorage({ url: URL, key: 'sb_secret_abc', fetch });
  const link = await storage.signUpload(PATH);
  assert.equal(link, `${URL}/storage/v1/object/upload/sign/ads/${PATH}?token=t1`);
  assert.equal(calls[0].url, `${URL}/storage/v1/object/upload/sign/ads/${PATH}`);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.apikey, 'sb_secret_abc');
  assert.equal(calls[0].headers.Authorization, undefined, 'новый ключ — только в apikey');
});

test('старый ключ service_role (JWT) уходит ещё и в Authorization', async () => {
  const { fetch, calls } = fakeFetch({ status: 200, body: { url: '/object/upload/sign/ads/x?token=t' } });
  await createStorage({ url: URL, key: 'eyJhbGciOi.x.y', fetch }).signUpload(PATH);
  assert.equal(calls[0].headers.Authorization, 'Bearer eyJhbGciOi.x.y');
});

test('удаление — DELETE по хранилищу со списком путей; пустой список не шлём', async () => {
  const { fetch, calls } = fakeFetch();
  const storage = createStorage({ url: URL, key: 'k', fetch });
  await storage.remove([]);
  await storage.remove([PATH]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${URL}/storage/v1/object/ads`);
  assert.equal(calls[0].method, 'DELETE');
  assert.deepEqual(calls[0].body, { prefixes: [PATH] });
});

test('ошибка Supabase — исключение с кодом ответа', async () => {
  const storage = createStorage({ url: URL, key: 'k', fetch: fakeFetch({ status: 400, body: { message: 'Bucket not found' } }).fetch });
  await assert.rejects(storage.signUpload(PATH), /400/);
  await assert.rejects(storage.remove([PATH]), /400/);
});

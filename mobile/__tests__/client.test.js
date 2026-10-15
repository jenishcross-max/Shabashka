import { request, setToken, setUnauthorizedHandler, ApiError } from '../src/api/client';
import { API_URL } from '../src/config';

const reply = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  global.fetch = jest.fn();
  setToken(null);
  setUnauthorizedHandler(() => {});
});

test('GET с параметрами: пустые не уходят в адрес', async () => {
  fetch.mockReturnValue(reply(200, { tasks: [] }));
  await request('/tasks', { query: { q: 'забор', category: '', city: null, page: 2 } });
  expect(fetch.mock.calls[0][0]).toBe(`${API_URL}/tasks?q=%D0%B7%D0%B0%D0%B1%D0%BE%D1%80&page=2`);
});

test('токен уходит в заголовке, тело — JSON', async () => {
  setToken('abc');
  fetch.mockReturnValue(reply(201, { ok: true }));
  await request('/tasks', { method: 'POST', body: { title: 'x' } });
  const [, init] = fetch.mock.calls[0];
  expect(init.method).toBe('POST');
  expect(init.headers.Authorization).toBe('Bearer abc');
  expect(init.headers['Content-Type']).toBe('application/json');
  expect(init.body).toBe('{"title":"x"}');
});

test('без входа заголовка Authorization нет', async () => {
  fetch.mockReturnValue(reply(200, {}));
  await request('/tasks');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
});

test('ошибка сервера — ApiError с текстом и кодом', async () => {
  fetch.mockReturnValue(reply(403, { error: 'Подтвердите email', code: 'EMAIL_NOT_VERIFIED' }));
  await expect(request('/tasks', { method: 'POST', body: {} })).rejects.toMatchObject({
    status: 403,
    message: 'Подтвердите email',
    code: 'EMAIL_NOT_VERIFIED',
  });
});

test('ответ не JSON (страница ошибки прокси) — общий текст со статусом', async () => {
  fetch.mockReturnValue(
    Promise.resolve({ ok: false, status: 502, json: async () => JSON.parse('<html>') })
  );
  await expect(request('/tasks')).rejects.toMatchObject({ status: 502, message: 'Ошибка сервера (502)' });
});

test('нет сети — ApiError со статусом 0', async () => {
  fetch.mockRejectedValue(new TypeError('Network request failed'));
  const err = await request('/tasks').catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(0);
  expect(err.message).toMatch(/Нет связи с сервером/);
});

test('401 при входе в аккаунт — сообщаем, что токен больше не годится', async () => {
  const onUnauthorized = jest.fn();
  setUnauthorizedHandler(onUnauthorized);
  setToken('old');
  fetch.mockReturnValue(reply(401, { error: 'Недействительный или истёкший токен' }));
  await expect(request('/auth/me')).rejects.toBeInstanceOf(ApiError);
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
});

test('401 без токена (неверный пароль) — не выход, просто ошибка', async () => {
  const onUnauthorized = jest.fn();
  setUnauthorizedHandler(onUnauthorized);
  fetch.mockReturnValue(reply(401, { error: 'Неверный email или пароль' }));
  await expect(request('/auth/login', { method: 'POST', body: {} })).rejects.toThrow('Неверный email или пароль');
  expect(onUnauthorized).not.toHaveBeenCalled();
});

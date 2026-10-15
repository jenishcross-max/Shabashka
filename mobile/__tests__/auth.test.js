import { renderHook, act, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthProvider, useAuth } from '../src/auth/AuthContext';

const reply = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const user = { id: 7, name: 'Айбек', email: 'a@b.kg', emailVerified: true };
const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
const saved = async () => JSON.parse(await SecureStore.getItemAsync('auth'));

beforeEach(() => {
  SecureStore.__reset();
  global.fetch = jest.fn();
});

test('без сохранённого входа — гость, на сервер не ходим', async () => {
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('guest'));
  expect(fetch).not.toHaveBeenCalled();
});

test('вход сохраняет токен и пользователя', async () => {
  fetch.mockReturnValue(reply(200, { token: 't1', user }));
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('guest'));
  await act(() => result.current.signIn('a@b.kg', 'password1'));
  expect(result.current.status).toBe('user');
  expect(result.current.user.name).toBe('Айбек');
  expect(await saved()).toEqual({ token: 't1', user });
});

test('регистрация — сразу вошёл', async () => {
  fetch.mockReturnValue(reply(201, { token: 't2', user }));
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('guest'));
  await act(() => result.current.signUp({ name: 'Айбек', email: 'a@b.kg', phone: '0700123456', password: 'password1' }));
  expect(result.current.status).toBe('user');
  expect(JSON.parse(fetch.mock.calls[0][1].body).phone).toBe('0700123456');
});

test('сохранённый вход восстанавливается сразу и сверяется с сервером', async () => {
  await SecureStore.setItemAsync('auth', JSON.stringify({ token: 't1', user }));
  fetch.mockReturnValue(reply(200, { user: { ...user, name: 'Айбек Т.' } }));
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(result.current.user?.name).toBe('Айбек Т.'));
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer t1');
  expect((await saved()).user.name).toBe('Айбек Т.');
});

test('сервер не узнал токен — выход', async () => {
  await SecureStore.setItemAsync('auth', JSON.stringify({ token: 'old', user }));
  fetch.mockReturnValue(reply(401, { error: 'Недействительный или истёкший токен' }));
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('guest'));
  expect(await SecureStore.getItemAsync('auth')).toBeNull();
});

test('нет сети при запуске — остаёмся вошедшими', async () => {
  await SecureStore.setItemAsync('auth', JSON.stringify({ token: 't1', user }));
  fetch.mockRejectedValue(new TypeError('Network request failed'));
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(result.current.status).toBe('user');
  expect(result.current.user.name).toBe('Айбек');
});

test('неверный пароль — ошибка наружу, остаёмся гостем', async () => {
  fetch.mockReturnValue(reply(401, { error: 'Неверный email или пароль' }));
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('guest'));
  await expect(act(() => result.current.signIn('a@b.kg', 'bad'))).rejects.toThrow('Неверный email или пароль');
  expect(result.current.status).toBe('guest');
});

test('выход стирает сохранённый вход', async () => {
  await SecureStore.setItemAsync('auth', JSON.stringify({ token: 't1', user }));
  fetch.mockReturnValue(reply(200, { user }));
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(result.current.status).toBe('user'));
  await act(() => result.current.signOut());
  expect(result.current.status).toBe('guest');
  expect(await SecureStore.getItemAsync('auth')).toBeNull();
});

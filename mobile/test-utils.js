import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';
import { AuthProvider } from './src/auth/AuthContext';

// Общее для тестов экранов: сеть по маршрутам, экран с провайдерами приложения,
// ответ на нативный диалог. Свои модули не подменяем — только fetch, SecureStore
// (jest.setup.js) и Alert, которого в Jest нет.

export const reply = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });

const keyOf = (url, init = {}) => `${init.method || 'GET'} ${new URL(url).pathname.replace(/^\/api/, '')}`;

// Сервер по маршрутам: { 'GET /tasks/5': ответ }. Ответ — тело (200), [статус, тело]
// или функция (тело запроса, URL) => одно из них: так сервер «помнит» действие
// и следующий GET отдаёт уже новое состояние. /auth/me по умолчанию
// подтверждает сохранённый вход; неизвестный адрес — 404, чтобы тест падал понятно.
export function serve(routes) {
  fetch.mockImplementation(async (url, init = {}) => {
    const key = keyOf(url, init);
    let answer = routes[key];
    if (answer === undefined && key === 'GET /auth/me') {
      return reply(200, { user: JSON.parse(await SecureStore.getItemAsync('auth')).user });
    }
    if (typeof answer === 'function') answer = answer(init.body ? JSON.parse(init.body) : undefined, new URL(url));
    if (answer === undefined) return reply(404, { error: `В тесте нет ответа на ${key}` });
    return Array.isArray(answer) ? reply(answer[0], answer[1]) : reply(200, answer);
  });
}

// Запросы, ушедшие на маршрут: [{ url, init, body }].
export const sent = (key) =>
  fetch.mock.calls
    .filter(([url, init]) => keyOf(url, init) === key)
    .map(([url, init = {}]) => ({ url: new URL(url), init, body: init.body ? JSON.parse(init.body) : undefined }));

let clients = [];
afterEach(() => {
  clients.forEach((client) => client.clear());
  clients = [];
});

// Экран с теми же провайдерами, что в приложении. user — вошедший: вход
// восстанавливается из SecureStore, как при запуске приложения. cache — что уже
// лежит в кэше запросов до открытия экрана: [[ключ, данные], ...].
export async function renderScreen(ui, { user, cache = [] } = {}) {
  SecureStore.__reset();
  if (user) await SecureStore.setItemAsync('auth', JSON.stringify({ token: 't', user }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  for (const [key, data] of cache) client.setQueryData(key, data);
  await render(
    <QueryClientProvider client={client}>
      <AuthProvider>{ui}</AuthProvider>
    </QueryClientProvider>
  );
  return { client };
}

// Нативный диалог в Jest не показывается — нажимаем в нём кнопку сами: не
// «Отмена» (confirm) или «Отмена» (cancel). Вызовы — в возвращённом шпионе.
export function answerAlerts(choice = 'confirm') {
  return jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons = []) => {
    const button = buttons.find((b) => (choice === 'confirm' ? b.style !== 'cancel' : b.style === 'cancel'));
    button?.onPress?.();
  });
}

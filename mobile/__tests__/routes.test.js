import { renderRouter, screen, fireEvent, waitFor } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';
import path from 'path';
import { serve } from '../test-utils';

// renderRouter считает путь от папки запуска Jest, а не от теста — даём абсолютный.
const APP_DIR = path.join(__dirname, '../src/app');

// В SDK 57 renderRouter вешает getPathname на промис, а не на результат (RNTL 14
// сделал render асинхронным), — поэтому храним сам промис и спрашиваем путь у него.
// Отдаём его в объекте: вернув промис из async-функции, получили бы его результат.
async function open(url) {
  const app = renderRouter(APP_DIR, { initialUrl: url });
  await app;
  return { app };
}

// Настоящие маршруты из src/app: проверяем, что экраны связаны с роутером так,
// как задумано, — сами экраны проверяются в своих тестах.
const task = {
  id: 1,
  title: 'Покрасить забор',
  description: 'Забор 20 метров',
  category: 'Ремонт',
  city: 'Бишкек',
  work_format: 'offline',
  budget: 5000,
  offers_count: 0,
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  SecureStore.__reset();
  global.fetch = jest.fn();
  serve({
    'GET /orders/categories': { categories: ['Ремонт'] },
    'GET /tasks': { tasks: [task], total: 1, page: 1, pages: 1 },
    'GET /tasks/1': { task: { ...task, user_id: 3, owner_name: 'Айгуль', status: 'open', views: 0 }, my_offer: null },
    'GET /tasks/1/offers': { offers: [] },
    'GET /tasks/mine': { tasks: [{ ...task, id: 1, user_id: 3, status: 'open', new_offers: 0 }] },
    'GET /tasks/my-offers': { offers: [] },
  });
});

// renderRouter включает фейковые таймеры — возвращаем настоящие.
afterEach(() => jest.useRealTimers());

test('приложение открывается на ленте биржи', async () => {
  const { app } = await open('/');
  expect(await screen.findByText('Покрасить забор')).toBeTruthy();
  expect(app).toHavePathname('/tasks');
});

test('карточка открывает страницу задачи', async () => {
  const { app } = await open('/tasks');
  await fireEvent.press(await screen.findByText('Покрасить забор'));
  await waitFor(() => expect(app).toHavePathname('/tasks/1'));
});

test('гость: «Разместить задачу» ведёт на вход', async () => {
  const { app } = await open('/tasks');
  await fireEvent.press(await screen.findByRole('button', { name: '+ Разместить задачу' }));
  await waitFor(() => expect(app).toHavePathname('/login'));
});

test('вошедший: «Разместить задачу» ведёт на форму', async () => {
  await SecureStore.setItemAsync('auth', JSON.stringify({ token: 't', user: { id: 7, name: 'Айбек' } }));
  const { app } = await open('/tasks');
  await fireEvent.press(await screen.findByRole('button', { name: '+ Разместить задачу' }));
  await waitFor(() => expect(app).toHavePathname('/tasks/new'));
  expect(await screen.findByRole('button', { name: 'Опубликовать задачу' })).toBeTruthy();
});

test('страница задачи: гостя зовёт войти, чтобы откликнуться', async () => {
  const { app } = await open('/tasks/1');
  expect(await screen.findByText('Забор 20 метров')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Войдите, чтобы откликнуться' }));
  await waitFor(() => expect(app).toHavePathname('/login'));
});

test('исполнитель: «Откликнуться» открывает форму отклика', async () => {
  await SecureStore.setItemAsync('auth', JSON.stringify({ token: 't', user: { id: 7, name: 'Айбек' } }));
  const { app } = await open('/tasks/1');
  await fireEvent.press(await screen.findByRole('button', { name: 'Откликнуться' }));
  await waitFor(() => expect(app).toHavePathname('/tasks/1/offer'));
  expect(await screen.findByRole('button', { name: 'Отправить отклик' })).toBeTruthy();
});

test('заказчик: «Изменить задачу» открывает форму с задачей', async () => {
  await SecureStore.setItemAsync('auth', JSON.stringify({ token: 't', user: { id: 3, name: 'Айгуль' } }));
  const { app } = await open('/tasks/1');
  await fireEvent.press(await screen.findByRole('button', { name: 'Изменить задачу' }));
  await waitFor(() => expect(app).toHavePathname('/tasks/1/edit'));
  expect(await screen.findByDisplayValue('Покрасить забор')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Сохранить' })).toBeTruthy();
});

test('«Моё»: свои задачи открываются на своих страницах', async () => {
  await SecureStore.setItemAsync('auth', JSON.stringify({ token: 't', user: { id: 3, name: 'Айгуль' } }));
  const { app } = await open('/tasks');
  await screen.findByText('Покрасить забор');
  await fireEvent.press(screen.getByRole('tab', { name: 'Моё' }));
  await fireEvent.press(await screen.findByText('Открыта'));
  await waitFor(() => expect(app).toHavePathname('/tasks/1'));
});

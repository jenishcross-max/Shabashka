import { screen, fireEvent } from '@testing-library/react-native';
import MyExchange from '../src/screens/MyExchange';
import ExchangeHome from '../src/screens/ExchangeHome';
import { renderScreen, serve, sent } from '../test-utils';

const user = { id: 3, name: 'Айгуль' };

const myTask = (id, extra = {}) => ({
  id,
  user_id: user.id,
  title: `Моя задача ${id}`,
  category: 'Ремонт',
  city: 'Бишкек',
  work_format: 'offline',
  budget: 5000,
  status: 'open',
  offers_count: 2,
  new_offers: 0,
  created_at: new Date().toISOString(),
  ...extra,
});

const myOffer = (id, extra = {}) => ({
  id,
  task_id: id + 100,
  price: 2500,
  term: 'завтра',
  status: 'active',
  state: 'waiting',
  task_title: `Чужая задача ${id}`,
  task_city: 'Ош',
  task_status: 'open',
  conversation_id: null,
  ...extra,
});

beforeEach(() => {
  global.fetch = jest.fn();
});

async function setup({ tasks = [], offers = [], who = user } = {}) {
  const props = { onOpen: jest.fn(), onLogin: jest.fn(), onNew: jest.fn(), onBrowse: jest.fn() };
  serve({ 'GET /tasks/mine': { tasks }, 'GET /tasks/my-offers': { offers } });
  await renderScreen(<MyExchange {...props} />, { user: who });
  return props;
}

test('гость — приглашение войти', async () => {
  const { onLogin } = await setup({ who: null });
  expect(await screen.findByText(/Войдите, чтобы видеть свои задачи и отклики/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));
  expect(onLogin).toHaveBeenCalled();
  expect(sent('GET /tasks/mine')).toHaveLength(0);
});

test('мои задачи: статус, новые отклики, число откликов; нажатие открывает задачу', async () => {
  const { onOpen } = await setup({
    tasks: [myTask(5, { new_offers: 2 }), myTask(6, { status: 'done', offers_count: 1, budget: null })],
  });
  expect(await screen.findByText('Моя задача 5')).toBeTruthy();
  expect(screen.getByText('Открыта')).toBeTruthy();
  expect(screen.getByText('Выполнена')).toBeTruthy();
  expect(screen.getAllByText('+2 новых')).toHaveLength(1);
  expect(screen.getByText(/Бишкек · до 5\s000 сом · 2 отклика · сегодня/)).toBeTruthy();
  expect(screen.getByText(/Цену предложат исполнители · 1 отклик/)).toBeTruthy();
  await fireEvent.press(screen.getByText('Моя задача 6'));
  expect(onOpen).toHaveBeenCalledWith(6);
});

test('мои отклики: состояние, своя цена; нажатие открывает задачу', async () => {
  const { onOpen } = await setup({
    tasks: [myTask(5)],
    offers: [myOffer(1), myOffer(2, { state: 'other', task_status: 'assigned' })],
  });
  await screen.findByText('Моя задача 5');
  await fireEvent.press(screen.getByRole('tab', { name: 'Мои отклики' }));
  expect(screen.getByText('Чужая задача 1')).toBeTruthy();
  expect(screen.getByText('Ждёт решения')).toBeTruthy();
  expect(screen.getByText('Выбран другой')).toBeTruthy();
  expect(screen.getAllByText(/Ош · ваша цена 2\s500 сом · завтра/)).toHaveLength(2);
  expect(screen.queryByText('Моя задача 5')).toBeNull();
  await fireEvent.press(screen.getByText('Чужая задача 2'));
  expect(onOpen).toHaveBeenCalledWith(102);
});

test('пустые списки — что делать дальше', async () => {
  const { onNew, onBrowse } = await setup();
  expect(await screen.findByText(/Вы ещё не размещали задач/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Разместить задачу' }));
  expect(onNew).toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('tab', { name: 'Мои отклики' }));
  expect(screen.getByText(/Вы ещё не откликались/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Смотреть задачи' }));
  expect(onBrowse).toHaveBeenCalled();
});

test('ошибка — текст и «Повторить»', async () => {
  serve({ 'GET /tasks/mine': [500, { error: 'Ошибка сервера' }], 'GET /tasks/my-offers': { offers: [] } });
  await renderScreen(<MyExchange onOpen={jest.fn()} onLogin={jest.fn()} onNew={jest.fn()} onBrowse={jest.fn()} />, {
    user,
  });
  expect(await screen.findByText('Ошибка сервера')).toBeTruthy();
  serve({ 'GET /tasks/mine': { tasks: [myTask(5)] }, 'GET /tasks/my-offers': { offers: [] } });
  await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
  expect(await screen.findByText('Моя задача 5')).toBeTruthy();
});

describe('переключатель «Все задачи / Моё» над лентой', () => {
  const feedTask = { ...myTask(9), title: 'Задача из ленты', description: 'Описание', user_id: 8 };

  async function setupHome() {
    serve({
      'GET /orders/categories': { categories: ['Ремонт'] },
      'GET /tasks': { tasks: [feedTask], total: 1, page: 1, pages: 1 },
      'GET /tasks/mine': { tasks: [myTask(5)] },
      'GET /tasks/my-offers': { offers: [] },
    });
    await renderScreen(<ExchangeHome onOpen={jest.fn()} onNew={jest.fn()} onLogin={jest.fn()} />, { user });
    await screen.findByText('Задача из ленты');
  }

  test('«Моё» грузится, только когда его открыли', async () => {
    await setupHome();
    expect(sent('GET /tasks/mine')).toHaveLength(0);
    await fireEvent.press(screen.getByRole('tab', { name: 'Моё' }));
    expect(await screen.findByText('Моя задача 5')).toBeTruthy();
    expect(screen.queryByText('Задача из ленты')).toBeNull();
  });

  test('назад к ленте — тот же поиск, без новой загрузки', async () => {
    await setupHome();
    await fireEvent.changeText(screen.getByLabelText('Поиск'), 'забор');
    await fireEvent.press(screen.getByRole('tab', { name: 'Моё' }));
    await screen.findByText('Моя задача 5');
    await fireEvent.press(screen.getByRole('tab', { name: 'Все задачи' }));
    expect(screen.getByText('Задача из ленты')).toBeTruthy();
    expect(screen.getByDisplayValue('забор')).toBeTruthy();
    expect(sent('GET /tasks')).toHaveLength(1);
  });
});

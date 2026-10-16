import { screen, fireEvent, waitFor } from '@testing-library/react-native';
import TaskForm from '../src/screens/TaskForm';
import { renderScreen, serve, sent } from '../test-utils';

const user = { id: 3, name: 'Айгуль', city: 'Бишкек', emailVerified: true };

const CATEGORIES = { offline: ['Ремонт', 'Уборка'], online: ['Дизайн', 'Тексты'] };
const categories = { 'GET /orders/categories': (_, url) => ({ categories: CATEGORIES[url.searchParams.get('format')] }) };

const task = {
  id: 5,
  user_id: user.id,
  owner_name: user.name,
  title: 'Покрасить забор',
  description: 'Забор 20 метров',
  category: 'Ремонт',
  city: 'Ош',
  address: 'мкр. Джал',
  work_format: 'offline',
  budget: 5000,
  when_text: 'в субботу',
  status: 'open',
  views: 0,
  offers_count: 0,
  created_at: new Date().toISOString(),
};

beforeEach(() => {
  global.fetch = jest.fn();
});

async function setup({ id, routes = {}, who = user, cache } = {}) {
  const onDone = jest.fn();
  const onLogin = jest.fn();
  serve({ ...categories, ...routes });
  const { client } = await renderScreen(<TaskForm id={id} onDone={onDone} onLogin={onLogin} />, { user: who, cache });
  return { onDone, onLogin, client };
}

async function fillNew() {
  await fireEvent.changeText(await screen.findByLabelText('Что нужно сделать'), 'Убраться в квартире');
  await fireEvent.changeText(screen.getByLabelText('Подробности'), 'Две комнаты, окна');
  await fireEvent.press(screen.getByRole('button', { name: 'Категория: не выбрана' }));
  await fireEvent.press(await screen.findByText('Уборка'));
}

test('гость — сначала войти', async () => {
  const { onLogin } = await setup({ who: null });
  await fireEvent.press(await screen.findByRole('button', { name: 'Войти' }));
  expect(onLogin).toHaveBeenCalled();
});

test('размещение: поля уходят на сервер, после успеха — на страницу задачи', async () => {
  const { onDone, client } = await setup({
    routes: { 'POST /tasks': [201, { task: { ...task, id: 12 } }] },
    cache: [[['tasks', { q: '', category: '', city: '' }], { pages: [], pageParams: [] }]],
  });
  expect(await screen.findByText('Разместить задачу')).toBeTruthy();
  await fillNew();
  // Город — из аккаунта, его можно поменять.
  expect(screen.getByDisplayValue('Бишкек')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Бюджет, сом (необязательно)'), '3 000');
  await fireEvent.changeText(screen.getByLabelText('Когда нужно (необязательно)'), 'в субботу');
  await fireEvent.press(screen.getByRole('button', { name: 'Опубликовать задачу' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(12));
  expect(sent('POST /tasks')[0].body).toEqual({
    title: 'Убраться в квартире',
    description: 'Две комнаты, окна',
    category: 'Уборка',
    city: 'Бишкек',
    address: '',
    work_format: 'offline',
    budget: '3 000',
    when_text: 'в субботу',
  });
  // Лента биржи перечитается — новая задача появится в ней сразу.
  expect(client.getQueryState(['tasks', { q: '', category: '', city: '' }]).isInvalidated).toBe(true);
});

test('онлайн — свои категории, выбранная из офлайна сбрасывается', async () => {
  await setup();
  await fillNew();
  expect(screen.getByRole('button', { name: 'Категория: Уборка' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: 'Онлайн' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Категория: не выбрана' })).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Категория: не выбрана' }));
  expect(await screen.findByText('Дизайн')).toBeTruthy();
  expect(sent('GET /orders/categories').map((r) => r.url.searchParams.get('format'))).toEqual(['offline', 'online']);
});

test('ошибка сервера видна над кнопкой', async () => {
  const { onDone } = await setup({ routes: { 'POST /tasks': [400, { error: 'Опишите задачу подробнее' }] } });
  await fireEvent.changeText(await screen.findByLabelText('Что нужно сделать'), 'Забор');
  await fireEvent.press(screen.getByRole('button', { name: 'Опубликовать задачу' }));
  expect(await screen.findByText('Опишите задачу подробнее')).toBeTruthy();
  expect(onDone).not.toHaveBeenCalled();
});

test('почта не подтверждена — кнопка «Отправить письмо ещё раз»', async () => {
  await setup({
    routes: {
      'POST /tasks': [
        403,
        { error: 'Подтвердите email, чтобы разместить больше одного объявления', code: 'EMAIL_NOT_VERIFIED' },
      ],
      'POST /auth/resend-verification': { ok: true },
    },
  });
  await fillNew();
  await fireEvent.press(screen.getByRole('button', { name: 'Опубликовать задачу' }));
  expect(await screen.findByText('Подтвердите email, чтобы разместить больше одного объявления')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Отправить письмо ещё раз' }));
  expect(await screen.findByText(/Письмо отправлено/)).toBeTruthy();
  expect(sent('POST /auth/resend-verification')).toHaveLength(1);
});

test('правка подставляет текущие значения и шлёт PATCH', async () => {
  const { onDone } = await setup({
    id: '5',
    routes: { 'GET /tasks/5': { task, my_offer: null }, 'PATCH /tasks/5': (body) => ({ task: { ...task, ...body } }) },
  });
  expect(await screen.findByText('Изменить задачу')).toBeTruthy();
  expect(screen.getByDisplayValue('Покрасить забор')).toBeTruthy();
  expect(screen.getByDisplayValue('Забор 20 метров')).toBeTruthy();
  expect(screen.getByDisplayValue('Ош')).toBeTruthy();
  expect(screen.getByDisplayValue('мкр. Джал')).toBeTruthy();
  expect(screen.getByDisplayValue('5000')).toBeTruthy();
  expect(screen.getByDisplayValue('в субботу')).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Категория: Ремонт' })).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Что нужно сделать'), 'Покрасить забор и ворота');
  await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(5));
  expect(sent('PATCH /tasks/5')[0].body).toEqual({
    title: 'Покрасить забор и ворота',
    description: 'Забор 20 метров',
    category: 'Ремонт',
    city: 'Ош',
    address: 'мкр. Джал',
    work_format: 'offline',
    budget: '5000',
    when_text: 'в субботу',
  });
});

test('исполнитель уже выбран — править нельзя, формы нет', async () => {
  await setup({ id: '5', routes: { 'GET /tasks/5': { task: { ...task, status: 'assigned' }, my_offer: null } } });
  expect(await screen.findByText('Задачу можно править, пока исполнитель не выбран')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
});

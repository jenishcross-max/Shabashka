import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TasksFeed from '../src/screens/TasksFeed';

const reply = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const task = (id, extra = {}) => ({
  id,
  title: `Задача ${id}`,
  description: 'Описание',
  category: 'Ремонт',
  city: 'Бишкек',
  work_format: 'offline',
  budget: 3000,
  offers_count: 2,
  created_at: new Date().toISOString(),
  ...extra,
});

// Ответ по адресу: категории — для фильтра, задачи — по номеру страницы.
function serve(pages) {
  fetch.mockImplementation((url) => {
    if (url.includes('/orders/categories')) return reply({ categories: ['Ремонт', 'Уборка'] });
    const page = Number(new URL(url).searchParams.get('page'));
    return reply({ tasks: pages[page - 1], total: pages.flat().length, page, pages: pages.length });
  });
}

const taskCalls = () => fetch.mock.calls.map(([u]) => new URL(u)).filter((u) => u.pathname.endsWith('/tasks'));

let client;
async function setup() {
  const onOpen = jest.fn();
  const onNew = jest.fn();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <QueryClientProvider client={client}>
      <TasksFeed onOpen={onOpen} onNew={onNew} />
    </QueryClientProvider>
  );
  return { onOpen, onNew };
}

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => client.clear());

test('показывает задачи с бюджетом и числом откликов', async () => {
  serve([[task(1), task(2, { budget: null, offers_count: 0, work_format: 'online' })]]);
  await setup();
  expect(await screen.findByText('Задача 1')).toBeTruthy();
  expect(screen.getByText(/до 3\s000 сом/)).toBeTruthy();
  expect(screen.getByText('Цену предложат исполнители')).toBeTruthy();
  expect(screen.getByText(/2 отклика/)).toBeTruthy();
  expect(screen.getByText(/Пока без откликов/)).toBeTruthy();
  expect(screen.getByText('Онлайн')).toBeTruthy();
});

test('нажатие на карточку открывает задачу', async () => {
  serve([[task(5)]]);
  const { onOpen } = await setup();
  await fireEvent.press(await screen.findByText('Задача 5'));
  expect(onOpen).toHaveBeenCalledWith(5);
});

test('«Разместить задачу»', async () => {
  serve([[task(1)]]);
  const { onNew } = await setup();
  await fireEvent.press(await screen.findByRole('button', { name: '+ Разместить задачу' }));
  expect(onNew).toHaveBeenCalled();
});

test('поиск уходит в запрос по Enter, а не на каждую букву', async () => {
  serve([[task(1)]]);
  await setup();
  await screen.findByText('Задача 1');
  await fireEvent.changeText(screen.getByLabelText('Поиск'), 'кран');
  expect(taskCalls()).toHaveLength(1);
  await fireEvent(screen.getByLabelText('Поиск'), 'submitEditing');
  await waitFor(() => expect(taskCalls().some((u) => u.searchParams.get('q') === 'кран')).toBe(true));
});

test('фильтр по категории', async () => {
  serve([[task(1)]]);
  await setup();
  await screen.findByText('Задача 1');
  await fireEvent.press(screen.getByRole('button', { name: 'Категория: все' }));
  await fireEvent.press(await screen.findByText('Уборка'));
  await waitFor(() => expect(taskCalls().some((u) => u.searchParams.get('category') === 'Уборка')).toBe(true));
  expect(screen.getByRole('button', { name: 'Категория: Уборка' })).toBeTruthy();
  // В фильтре — все категории, без формата.
  const categoryCalls = fetch.mock.calls.map(([u]) => u).filter((u) => u.includes('/orders/categories'));
  expect(categoryCalls.every((u) => u.endsWith('/orders/categories'))).toBe(true);
});

test('прокрутка до конца подгружает следующую страницу', async () => {
  serve([[task(1), task(2)], [task(3)]]);
  await setup();
  await screen.findByText('Задача 1');
  await fireEvent(screen.getByTestId('tasks-list'), 'endReached');
  expect(await screen.findByText('Задача 3')).toBeTruthy();
  expect(taskCalls().map((u) => u.searchParams.get('page'))).toEqual(['1', '2']);
});

test('пустая лента — понятный текст', async () => {
  serve([[]]);
  await setup();
  expect(await screen.findByText(/Задач пока нет/)).toBeTruthy();
});

test('ошибка — текст и «Повторить», повтор загружает ленту', async () => {
  fetch.mockRejectedValue(new TypeError('Network request failed'));
  await setup();
  expect(await screen.findByText(/Нет связи с сервером/)).toBeTruthy();
  serve([[task(1)]]);
  await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
  expect(await screen.findByText('Задача 1')).toBeTruthy();
});

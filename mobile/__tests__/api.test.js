import { listTasks } from '../src/api/tasks';
import { nextPage } from '../src/api/paging';
import { shouldRetry } from '../src/queryClient';

const reply = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  global.fetch = jest.fn();
});

test('лента биржи: фильтры и страница уходят в запрос, пустой город — нет', async () => {
  fetch.mockReturnValue(reply({ tasks: [], total: 0, page: 1, pages: 1 }));
  await listTasks({ q: 'кран', category: 'Сантехника', city: '', page: 3 });
  const url = new URL(fetch.mock.calls[0][0]);
  expect(url.pathname).toMatch(/\/tasks$/);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    q: 'кран',
    category: 'Сантехника',
    page: '3',
    limit: '20',
  });
});

test('повтор запроса — только при нет сети и 5xx, и один раз', () => {
  expect(shouldRetry(0, { status: 0 })).toBe(true);
  expect(shouldRetry(0, { status: 502 })).toBe(true);
  expect(shouldRetry(1, { status: 502 })).toBe(false);
  expect(shouldRetry(0, { status: 404 })).toBe(false);
  expect(shouldRetry(0, { status: 401 })).toBe(false);
});

test('nextPage: следующая страница или конец', () => {
  expect(nextPage({ page: 1, pages: 3 })).toBe(2);
  expect(nextPage({ page: 3, pages: 3 })).toBeUndefined();
});

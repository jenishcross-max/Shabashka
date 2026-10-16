import { screen, fireEvent } from '@testing-library/react-native';
import TaskDetail from '../src/screens/TaskDetail';
import { renderScreen, serve, sent } from '../test-utils';

const owner = { id: 3, name: 'Айгуль' };
const worker = { id: 7, name: 'Айбек' };

const task = (extra = {}) => ({
  id: 5,
  user_id: owner.id,
  owner_name: owner.name,
  title: 'Покрасить забор',
  description: 'Забор 20 метров, краска есть',
  category: 'Ремонт',
  city: 'Бишкек',
  address: 'мкр. Джал',
  work_format: 'offline',
  budget: 5000,
  when_text: 'в субботу',
  status: 'open',
  views: 12,
  offers_count: 2,
  created_at: new Date().toISOString(),
  ...extra,
});

const offer = (extra = {}) => ({ id: 40, price: 2500, term: 'завтра', comment: 'Покрашу в два слоя', state: 'waiting', ...extra });

async function setup({ user, data, offers = [] } = {}) {
  const props = { onLogin: jest.fn(), onOffer: jest.fn(), onChat: jest.fn(), onEdit: jest.fn() };
  serve({
    'GET /tasks/5': data ?? { task: task(), my_offer: null, conversation_id: null },
    'GET /tasks/5/offers': { offers },
  });
  await renderScreen(<TaskDetail id="5" {...props} />, { user });
  return props;
}

beforeEach(() => {
  global.fetch = jest.fn();
});

test('общая часть: статус, бюджет, когда, где, описание, заказчик, просмотры', async () => {
  await setup();
  expect(await screen.findByText('Покрасить забор')).toBeTruthy();
  expect(screen.getByText('Открыта')).toBeTruthy();
  expect(screen.getByText(/до 5\s000 сом/)).toBeTruthy();
  expect(screen.getByText('Когда: в субботу')).toBeTruthy();
  expect(screen.getByText('Бишкек, мкр. Джал')).toBeTruthy();
  expect(screen.getByText('Забор 20 метров, краска есть')).toBeTruthy();
  expect(screen.getByText('Заказчик: Айгуль')).toBeTruthy();
  expect(screen.getByText('12 просмотров')).toBeTruthy();
});

test('онлайн-задача — «Онлайн» вместо города, без бюджета — цену предложат', async () => {
  await setup({ data: { task: task({ work_format: 'online', budget: null }), my_offer: null } });
  expect(await screen.findByText('Онлайн')).toBeTruthy();
  expect(screen.queryByText(/Бишкек/)).toBeNull();
  expect(screen.getByText('Цену предложат исполнители')).toBeTruthy();
});

test('гость: «Войдите, чтобы откликнуться» ведёт на вход', async () => {
  const { onLogin } = await setup();
  await fireEvent.press(await screen.findByRole('button', { name: 'Войдите, чтобы откликнуться' }));
  expect(onLogin).toHaveBeenCalled();
  expect(sent('GET /tasks/5')[0].init.headers.Authorization).toBeUndefined();
});

test('исполнитель без отклика: число откликов и «Откликнуться»', async () => {
  const { onOffer } = await setup({ user: worker });
  expect(await screen.findByText('2 отклика на эту задачу')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Откликнуться' }));
  expect(onOffer).toHaveBeenCalled();
  // Свой отклик сервер отдаёт только по токену — без него экран не узнал бы его.
  expect(sent('GET /tasks/5')[0].init.headers.Authorization).toBe('Bearer t');
});

test('исполнитель с откликом: состояние, своя цена, «Изменить»', async () => {
  const { onOffer } = await setup({ user: worker, data: { task: task(), my_offer: offer() } });
  expect(await screen.findByText('Ждёт решения')).toBeTruthy();
  expect(screen.getByText(/2\s500 сом/)).toBeTruthy();
  expect(screen.getByText('Срок: завтра')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Откликнуться' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Изменить' }));
  expect(onOffer).toHaveBeenCalled();
});

test('исполнителя выбрали — «Перейти к переписке»', async () => {
  const { onChat } = await setup({
    user: worker,
    data: { task: task({ status: 'assigned' }), my_offer: offer({ state: 'chosen' }), conversation_id: 77 },
  });
  expect(await screen.findByText('Заказчик выбрал вас исполнителем')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Перейти к переписке' }));
  expect(onChat).toHaveBeenCalledWith(77);
});

test('выбран другой — подпись состояния, откликнуться нельзя', async () => {
  await setup({ user: worker, data: { task: task({ status: 'assigned' }), my_offer: offer({ state: 'other' }) } });
  expect(await screen.findByText('Выбран другой')).toBeTruthy();
  expect(screen.getByText('Заказчик выбрал другого исполнителя.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Откликнуться' })).toBeNull();
});

test('отозванный отклик на открытой задаче — «Откликнуться снова»', async () => {
  const { onOffer } = await setup({ user: worker, data: { task: task(), my_offer: offer({ state: 'withdrawn' }) } });
  expect(await screen.findByText('Отозван')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Откликнуться снова' }));
  expect(onOffer).toHaveBeenCalled();
});

test('закрытая задача не предлагает откликнуться', async () => {
  await setup({ user: worker, data: { task: task({ status: 'assigned' }), my_offer: null } });
  expect(await screen.findByText('Исполнитель уже выбран — новые отклики не принимаются.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Откликнуться' })).toBeNull();
});

test('заказчик видит «Отклики (N)», а не «Откликнуться»', async () => {
  await setup({ user: owner, offers: [{ ...offer(), user_name: 'Б', done_count: 0, user_since: '2026-01-01' }] });
  expect(await screen.findByText('Отклики (1)')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Откликнуться' })).toBeNull();
});

test('задачи нет — «Задача не найдена»', async () => {
  serve({ 'GET /tasks/5': [404, { error: 'Задача не найдена' }] });
  await renderScreen(<TaskDetail id="5" onLogin={jest.fn()} onOffer={jest.fn()} onChat={jest.fn()} onEdit={jest.fn()} />);
  expect(await screen.findByText('Задача не найдена')).toBeTruthy();
});

import { screen, fireEvent, waitFor } from '@testing-library/react-native';
import TaskDetail from '../src/screens/TaskDetail';
import { renderScreen, serve, sent, answerAlerts } from '../test-utils';

const owner = { id: 3, name: 'Айгуль' };

const task = (extra = {}) => ({
  id: 5,
  user_id: owner.id,
  owner_name: owner.name,
  title: 'Покрасить забор',
  description: 'Забор 20 метров',
  category: 'Ремонт',
  city: 'Бишкек',
  work_format: 'offline',
  budget: 5000,
  status: 'open',
  views: 3,
  offers_count: 2,
  created_at: new Date().toISOString(),
  ...extra,
});

const offer = (id, extra = {}) => ({
  id,
  task_id: 5,
  price: 2500,
  term: 'завтра',
  comment: `Комментарий ${id}`,
  status: 'active',
  is_new: false,
  user_name: `Мастер ${id}`,
  user_since: '2026-03-10T00:00:00Z',
  done_count: 0,
  ...extra,
});

const offers = [offer(40, { is_new: true }), offer(41, { price: 3000, done_count: 5 })];

async function setup({
  data = { task: task(), my_offer: null, conversation_id: null },
  list = offers,
  routes = {},
  user = owner,
  cache,
} = {}) {
  const props = { onLogin: jest.fn(), onOffer: jest.fn(), onChat: jest.fn(), onEdit: jest.fn() };
  serve({ 'GET /tasks/5': data, 'GET /tasks/5/offers': { offers: list }, ...routes });
  const { client } = await renderScreen(<TaskDetail id="5" {...props} />, { user, cache });
  await screen.findByText('Покрасить забор');
  return { ...props, client };
}

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => jest.restoreAllMocks());

test('отклики: имя, цена, срок, комментарий, опыт, метка «Новый»', async () => {
  await setup();
  expect(await screen.findByText('Отклики (2)')).toBeTruthy();
  expect(screen.getByText('Мастер 40')).toBeTruthy();
  expect(screen.getByText(/3\s000 сом/)).toBeTruthy();
  expect(screen.getAllByText('Срок: завтра')).toHaveLength(2);
  expect(screen.getByText('Комментарий 41')).toBeTruthy();
  expect(screen.getByText('Новичок на бирже · на сайте с марта 2026')).toBeTruthy();
  expect(screen.getByText('5 задач выполнено на бирже · на сайте с марта 2026')).toBeTruthy();
  expect(screen.getAllByText('Новый')).toHaveLength(1);
});

test('открытие откликов гасит значок новых: счётчик перечитывается', async () => {
  const { client } = await setup({ cache: [[['unread', owner.id], { count: 0, offers: 1 }]] });
  await screen.findByText('Отклики (2)');
  await waitFor(() => expect(client.getQueryState(['unread', owner.id]).isInvalidated).toBe(true));
});

test('«Выбрать исполнителем» — подтверждение, выбор, переход в переписку', async () => {
  const alert = answerAlerts('confirm');
  const { onChat } = await setup({
    routes: { 'POST /tasks/5/offers/41/accept': { task: task({ status: 'assigned' }), conversation_id: 91 } },
  });
  await screen.findByText('Мастер 41');
  await fireEvent.press(screen.getAllByRole('button', { name: 'Выбрать исполнителем' })[1]);
  expect(alert).toHaveBeenCalledWith('Выбрать исполнителя?', expect.stringContaining('Мастер 41'), expect.any(Array));
  await waitFor(() => expect(onChat).toHaveBeenCalledWith(91));
  expect(sent('POST /tasks/5/offers/41/accept')).toHaveLength(1);
});

test('«Отмена» в диалоге выбора — ничего не уходит', async () => {
  answerAlerts('cancel');
  const { onChat } = await setup();
  await fireEvent.press((await screen.findAllByRole('button', { name: 'Выбрать исполнителем' }))[0]);
  expect(sent('POST /tasks/5/offers/40/accept')).toHaveLength(0);
  expect(onChat).not.toHaveBeenCalled();
});

test('409 при выборе — текст сервера и свежие данные', async () => {
  answerAlerts('confirm');
  const { onChat } = await setup({
    routes: { 'POST /tasks/5/offers/40/accept': [409, { error: 'Этот отклик уже нельзя выбрать — обновите страницу' }] },
  });
  await fireEvent.press((await screen.findAllByRole('button', { name: 'Выбрать исполнителем' }))[0]);
  expect(await screen.findByText('Этот отклик уже нельзя выбрать — обновите страницу')).toBeTruthy();
  await waitFor(() => expect(sent('GET /tasks/5/offers')).toHaveLength(2));
  expect(sent('GET /tasks/5')).toHaveLength(2);
  expect(onChat).not.toHaveBeenCalled();
});

test('жалоба на отклик — причина в своём окне, запрос, «Жалоба отправлена»', async () => {
  await setup({ routes: { 'POST /tasks/5/offers/40/report': [201, { ok: true }] } });
  await fireEvent.press((await screen.findAllByRole('button', { name: 'Пожаловаться' }))[0]);
  expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Причина'), 'Просит предоплату');
  await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
  expect(await screen.findByText('Жалоба отправлена — разберём в ближайшее время')).toBeTruthy();
  expect(sent('POST /tasks/5/offers/40/report')[0].body).toEqual({ reason: 'Просит предоплату' });
  expect(screen.queryByLabelText('Причина')).toBeNull();
});

test('открытая задача: «Изменить задачу» и «Отменить задачу» с подтверждением', async () => {
  answerAlerts('confirm');
  let status = 'open';
  const { onEdit } = await setup({
    data: () => ({ task: task({ status }), my_offer: null, conversation_id: null }),
    routes: {
      'POST /tasks/5/cancel': () => {
        status = 'cancelled';
        return { task: task({ status }) };
      },
    },
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Изменить задачу' }));
  expect(onEdit).toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Отменить задачу' }));
  expect(await screen.findByText('Задача отменена.')).toBeTruthy();
  expect(screen.getByText('Отменена')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Изменить задачу' })).toBeNull();
});

test('исполнитель выбран: переписка, «Выполнена», «Отменить выбор», «Отменить задачу»', async () => {
  answerAlerts('confirm');
  const chosen = offer(41, { status: 'accepted' });
  const { onChat } = await setup({
    data: { task: task({ status: 'assigned' }), my_offer: null, conversation_id: 91 },
    list: [chosen],
    routes: { 'POST /tasks/5/done': { task: task({ status: 'done' }) }, 'POST /tasks/5/unassign': { task: task() } },
  });
  expect(await screen.findByText('Ваш исполнитель')).toBeTruthy();
  expect(screen.getByText('Мастер 41')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Выбрать исполнителем' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Изменить задачу' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Отменить задачу' })).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: 'Написать исполнителю' }));
  expect(onChat).toHaveBeenCalledWith(91);
  await fireEvent.press(screen.getByRole('button', { name: 'Отменить выбор' }));
  await waitFor(() => expect(sent('POST /tasks/5/unassign')).toHaveLength(1));
  await fireEvent.press(screen.getByRole('button', { name: 'Задача выполнена' }));
  await waitFor(() => expect(sent('POST /tasks/5/done')).toHaveLength(1));
});

test('выполненная задача — исполнитель, без кнопок', async () => {
  await setup({
    data: { task: task({ status: 'done' }), my_offer: null, conversation_id: null },
    list: [offer(41, { status: 'accepted' })],
  });
  expect(await screen.findByText('Задача выполнена. Исполнитель: Мастер 41.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Отменить задачу' })).toBeNull();
});

test('жалоба на задачу — для гостя и исполнителя, не для заказчика', async () => {
  await setup({ user: null, routes: { 'POST /tasks/5/report': [201, { ok: true }] } });
  await fireEvent.press(screen.getByRole('button', { name: 'Пожаловаться на задачу' }));
  await fireEvent.changeText(screen.getByLabelText('Причина'), 'Работа за границей');
  await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
  expect(await screen.findByText('Жалоба отправлена — разберём в ближайшее время')).toBeTruthy();
  expect(sent('POST /tasks/5/report')[0].body).toEqual({ reason: 'Работа за границей' });
});

test('заказчику жаловаться на свою задачу незачем', async () => {
  await setup();
  await screen.findByText('Отклики (2)');
  expect(screen.queryByRole('button', { name: 'Пожаловаться на задачу' })).toBeNull();
});

test('ошибка жалобы видна в окне', async () => {
  await setup({ user: null, routes: { 'POST /tasks/5/report': [429, { error: 'Слишком много жалоб, попробуйте позже' }] } });
  await fireEvent.press(screen.getByRole('button', { name: 'Пожаловаться на задачу' }));
  await fireEvent.changeText(screen.getByLabelText('Причина'), 'Спам');
  await fireEvent.press(screen.getByRole('button', { name: 'Отправить' }));
  expect(await screen.findByText('Слишком много жалоб, попробуйте позже')).toBeTruthy();
  expect(screen.getByLabelText('Причина')).toBeTruthy();
});

import { screen, fireEvent, waitFor } from '@testing-library/react-native';
import OfferForm from '../src/screens/OfferForm';
import TaskDetail from '../src/screens/TaskDetail';
import { renderScreen, serve, sent, answerAlerts } from '../test-utils';

const worker = { id: 7, name: 'Айбек' };
const task = {
  id: 5,
  user_id: 3,
  owner_name: 'Айгуль',
  title: 'Покрасить забор',
  description: 'Забор 20 метров',
  category: 'Ремонт',
  city: 'Бишкек',
  work_format: 'offline',
  budget: 5000,
  status: 'open',
  views: 0,
  offers_count: 1,
  created_at: new Date().toISOString(),
};
const myOffer = { id: 40, price: 2500, term: 'завтра', comment: 'Покрашу в два слоя', status: 'active', state: 'waiting' };

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => jest.restoreAllMocks());

describe('форма отклика', () => {
  async function setup({ offer = null, post = (body) => [201, { offer: { ...myOffer, ...body } }] } = {}) {
    const onDone = jest.fn();
    serve({
      'GET /tasks/5': { task, my_offer: offer, conversation_id: null },
      'POST /tasks/5/offers': post,
    });
    // «Моё» уже открывали: после отклика список должен перечитаться.
    const { client } = await renderScreen(<OfferForm id="5" onDone={onDone} />, {
      user: worker,
      cache: [[['my-offers', worker.id], { offers: [] }]],
    });
    await screen.findByText('Покрасить забор');
    return { onDone, client };
  }

  async function fill(price, term, comment) {
    await fireEvent.changeText(screen.getByLabelText('Ваша цена, сом'), price);
    await fireEvent.changeText(screen.getByLabelText('Срок'), term);
    await fireEvent.changeText(screen.getByLabelText('Что сделаете'), comment);
  }

  test('новый отклик: поля уходят как набраны, после успеха — назад и данные перечитаны', async () => {
    const { onDone, client } = await setup();
    expect(screen.getByText('Предложить свою цену')).toBeTruthy();
    await fill('2 000', 'завтра до обеда', 'Покрашу в два слоя');
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить отклик' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // Цену разбирает сервер — «2 000» и «2000» для него одно и то же.
    expect(sent('POST /tasks/5/offers')[0].body).toEqual({
      price: '2 000',
      term: 'завтра до обеда',
      comment: 'Покрашу в два слоя',
    });
    expect(sent('GET /tasks/5')).toHaveLength(2);
    expect(client.getQueryState(['my-offers', worker.id]).isInvalidated).toBe(true);
  });

  test('ошибка сервера видна в форме, назад не уходим', async () => {
    const { onDone } = await setup({ post: () => [400, { error: 'Укажите цену — целое число сом' }] });
    await fill('', 'завтра', 'Покрашу');
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить отклик' }));
    expect(await screen.findByText('Укажите цену — целое число сом')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  test('правка подставляет текущие значения', async () => {
    const { onDone } = await setup({ offer: myOffer });
    expect(screen.getByText('Изменить отклик')).toBeTruthy();
    expect(screen.getByDisplayValue('2500')).toBeTruthy();
    expect(screen.getByDisplayValue('завтра')).toBeTruthy();
    expect(screen.getByDisplayValue('Покрашу в два слоя')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Ваша цена, сом'), '2300');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить отклик' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sent('POST /tasks/5/offers')[0].body).toEqual({ price: '2300', term: 'завтра', comment: 'Покрашу в два слоя' });
  });
});

describe('отозвать отклик', () => {
  async function setup() {
    let offer = myOffer;
    serve({
      'GET /tasks/5': () => ({ task, my_offer: offer, conversation_id: null }),
      'POST /tasks/5/offers/withdraw': () => {
        offer = { ...offer, status: 'withdrawn', state: 'withdrawn' };
        return { offer };
      },
    });
    await renderScreen(<TaskDetail id="5" onLogin={jest.fn()} onOffer={jest.fn()} onChat={jest.fn()} />, {
      user: worker,
    });
    await screen.findByText('Ждёт решения');
  }

  test('с подтверждением: запрос и состояние «Отозван»', async () => {
    const alert = answerAlerts('confirm');
    await setup();
    await fireEvent.press(screen.getByRole('button', { name: 'Отозвать' }));
    expect(alert).toHaveBeenCalledWith('Отозвать отклик?', expect.any(String), expect.any(Array));
    expect(await screen.findByText('Отозван')).toBeTruthy();
    expect(sent('POST /tasks/5/offers/withdraw')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Откликнуться снова' })).toBeTruthy();
  });

  test('«Отмена» в диалоге — отклик остаётся', async () => {
    answerAlerts('cancel');
    await setup();
    await fireEvent.press(screen.getByRole('button', { name: 'Отозвать' }));
    expect(sent('POST /tasks/5/offers/withdraw')).toHaveLength(0);
    expect(screen.getByText('Ждёт решения')).toBeTruthy();
  });
});

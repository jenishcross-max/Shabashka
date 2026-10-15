import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthProvider } from '../src/auth/AuthContext';
import LoginScreen from '../src/screens/LoginScreen';
import RegisterScreen from '../src/screens/RegisterScreen';

const reply = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const user = { id: 1, name: 'Айбек', email: 'a@b.kg' };

beforeEach(() => {
  SecureStore.__reset();
  global.fetch = jest.fn();
});

describe('вход', () => {
  async function setup() {
    const onDone = jest.fn();
    const onRegister = jest.fn();
    await render(
      <AuthProvider>
        <LoginScreen onDone={onDone} onRegister={onRegister} />
      </AuthProvider>
    );
    return { onDone, onRegister };
  }

  async function fill(email, password) {
    await fireEvent.changeText(screen.getByLabelText('Email'), email);
    await fireEvent.changeText(screen.getByLabelText('Пароль'), password);
    await fireEvent.press(screen.getByRole('button', { name: 'Войти' }));
  }

  test('успешный вход возвращает на прошлый экран', async () => {
    fetch.mockReturnValue(reply(200, { token: 't', user }));
    const { onDone } = await setup();
    await fill('a@b.kg', 'password1');
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ email: 'a@b.kg', password: 'password1' });
  });

  test('ошибка сервера видна, экран не закрывается', async () => {
    fetch.mockReturnValue(reply(401, { error: 'Неверный email или пароль' }));
    const { onDone } = await setup();
    await fill('a@b.kg', 'bad');
    expect(await screen.findByText('Неверный email или пароль')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  test('ссылка на регистрацию', async () => {
    const { onRegister } = await setup();
    await fireEvent.press(screen.getByText('Нет аккаунта? Зарегистрироваться'));
    expect(onRegister).toHaveBeenCalled();
  });
});

describe('регистрация', () => {
  async function setup() {
    const onDone = jest.fn();
    await render(
      <AuthProvider>
        <RegisterScreen onDone={onDone} onLogin={jest.fn()} />
      </AuthProvider>
    );
    await fireEvent.changeText(screen.getByLabelText('Имя'), 'Айбек');
    await fireEvent.changeText(screen.getByLabelText('Email'), 'a@b.kg');
    await fireEvent.changeText(screen.getByLabelText('WhatsApp'), '0700 123 456');
    await fireEvent.changeText(screen.getByLabelText('Пароль'), 'password1');
    await fireEvent.changeText(screen.getByLabelText('Город'), 'Бишкек');
    await fireEvent.press(screen.getByRole('button', { name: 'Зарегистрироваться' }));
    return { onDone };
  }

  test('поля уходят на сервер, после успеха — назад', async () => {
    fetch.mockReturnValue(reply(201, { token: 't', user }));
    const { onDone } = await setup();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      name: 'Айбек',
      email: 'a@b.kg',
      phone: '0700 123 456',
      password: 'password1',
      city: 'Бишкек',
    });
  });

  test('почта занята — текст сервера', async () => {
    fetch.mockReturnValue(reply(409, { error: 'Пользователь с таким email уже зарегистрирован' }));
    const { onDone } = await setup();
    expect(await screen.findByText('Пользователь с таким email уже зарегистрирован')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});

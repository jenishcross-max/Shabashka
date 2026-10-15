import { render, screen, fireEvent } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { AuthProvider } from '../src/auth/AuthContext';
import ProfileScreen from '../src/screens/ProfileScreen';

const reply = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
const user = { id: 7, name: 'Айбек', email: 'a@b.kg', emailVerified: false };

beforeEach(() => {
  SecureStore.__reset();
  global.fetch = jest.fn();
});

async function setup() {
  const onLogin = jest.fn();
  const onRegister = jest.fn();
  await render(
    <AuthProvider>
      <ProfileScreen onLogin={onLogin} onRegister={onRegister} />
    </AuthProvider>
  );
  return { onLogin, onRegister };
}

test('гость — войти или зарегистрироваться', async () => {
  const { onLogin, onRegister } = await setup();
  await fireEvent.press(await screen.findByRole('button', { name: 'Войти' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Зарегистрироваться' }));
  expect(onLogin).toHaveBeenCalled();
  expect(onRegister).toHaveBeenCalled();
});

test('вошедший — имя, почта, неподтверждённая почта и выход', async () => {
  await SecureStore.setItemAsync('auth', JSON.stringify({ token: 't', user }));
  fetch.mockReturnValue(reply(200, { user }));
  await setup();
  expect(await screen.findByText('Айбек')).toBeTruthy();
  expect(screen.getByText('a@b.kg')).toBeTruthy();
  expect(screen.getByText(/Почта не подтверждена/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Выйти' }));
  expect(await screen.findByRole('button', { name: 'Войти' })).toBeTruthy();
});

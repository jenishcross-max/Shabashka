import { render, screen, act } from '@testing-library/react-native';
import Loading from '../src/components/Loading';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('сначала просто индикатор, через 5 секунд — что сервер просыпается', async () => {
  await render(<Loading />);
  expect(screen.queryByText(/Сервер просыпается/)).toBeNull();
  await act(() => jest.advanceTimersByTime(5000));
  expect(screen.getByText(/Сервер просыпается/)).toBeTruthy();
});

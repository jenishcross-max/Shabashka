// TanStack Query сообщает экранам об ответе через setTimeout(0) — в тестах это
// иногда приходит мимо act() и сыплет предупреждениями. Синхронно — внутри act().
const { notifyManager } = require('@tanstack/react-query');
notifyManager.setScheduler((callback) => callback());

// Нативного SecureStore в Jest нет — держим значения в памяти процесса.
// __reset() — чистый лист перед каждым тестом.
jest.mock('expo-secure-store', () => {
  let store = {};
  return {
    getItemAsync: jest.fn(async (key) => (key in store ? store[key] : null)),
    setItemAsync: jest.fn(async (key, value) => {
      store[key] = value;
    }),
    deleteItemAsync: jest.fn(async (key) => {
      delete store[key];
    }),
    __reset: () => {
      store = {};
    },
  };
});

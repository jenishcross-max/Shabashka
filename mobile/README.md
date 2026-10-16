# Шабашка — Android-приложение

Expo SDK 57 (React Native), Expo Router, TanStack Query. Работает с тем же API, что и сайт
(`https://shabashka-zvkc.onrender.com/api`). План и решения —
[docs/plans/2026-10-15-android.md](../docs/plans/2026-10-15-android.md).

## Запуск на телефоне

```bash
cd mobile
npm install
npx expo start
```

Отсканируйте QR-код приложением **Expo Go** (Google Play). Expo Go открывает только проекты
на последнем SDK: если там уже SDK 58, нужна dev-сборка (`eas build --profile development`,
шаги — в плане, Task 21).

Другой адрес API (например, тестовый): `EXPO_PUBLIC_API_URL=https://.../api npx expo start`.

## Тесты

```bash
cd mobile
npm test
```

Jest (`jest-expo`) и React Native Testing Library 14 — у неё `render`, `fireEvent`, `act`
асинхронные, их нужно `await`. Подменяются только сеть (`global.fetch`) и SecureStore
(`jest.setup.js`), а системный диалог `Alert` — шпионом. Общее для тестов экранов — в
`test-utils.js`: `serve` (ответы сервера по маршрутам), `renderScreen` (экран с провайдерами
приложения и, если нужно, вошедшим пользователем), `answerAlerts`.

## Устройство

- `src/app/` — только маршруты Expo Router: связывают экраны с роутером.
- `src/screens/` — экраны; переходы получают колбэками, поэтому тестируются без роутера.
- `src/hooks/` — общие запросы экранов: `useTask` (задача биржи), `useTaskAction` (действие с
  задачей и что после него перечитать).
- `src/api/` — `client.js` (адрес, токен, ошибки) и функции по разделам API.
- `src/auth/AuthContext.js` — вход, регистрация, выход; токен в SecureStore.
- `src/exchange.js` — подписи биржи, копия `frontend/src/exchange.js` (держать в лад).

## Зависимости

Версии — точные и старше двух недель: ставить так (пример для даты 2026-10-01):

```bash
cd mobile
npm_config_before=2026-10-01 EXPO_OFFLINE=1 npx expo install <пакет>
```

`EXPO_OFFLINE=1` — чтобы `expo install` брал совместимые версии из установленного `expo`, а не
самые свежие с сервера Expo. После установки — убрать `~`/`^` в `package.json`.
`expo-doctor` из-за этого пишет, что патч-версии отстают от последних: это ожидаемо.

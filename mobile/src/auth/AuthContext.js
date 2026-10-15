import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { setToken, setUnauthorizedHandler } from '../api/client';
import * as authApi from '../api/auth';

// Токен и пользователь лежат вместе в SecureStore под одним ключом: при запуске
// человек сразу вошедший (по сохранённому пользователю), а сверка с /auth/me идёт
// в фоне — Render может просыпаться до минуты, держать всё это время экран
// загрузки нельзя.
const KEY = 'auth';

const AuthContext = createContext(null);

// status: 'loading' — читаем SecureStore, 'guest' — не вошёл, 'user' — вошёл.
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null });
  // Какой токен сейчас действует: ответ /auth/me, пришедший после выхода,
  // не должен снова впустить человека.
  const current = useRef(null);

  const signOut = useCallback(async () => {
    current.current = null;
    setToken(null);
    await SecureStore.deleteItemAsync(KEY);
    setState({ status: 'guest', user: null });
  }, []);

  const remember = useCallback(async ({ token, user }) => {
    current.current = token;
    setToken(token);
    await SecureStore.setItemAsync(KEY, JSON.stringify({ token, user }));
    setState({ status: 'user', user });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    (async () => {
      const saved = JSON.parse((await SecureStore.getItemAsync(KEY)) || 'null');
      if (!saved) {
        setState({ status: 'guest', user: null });
        return;
      }
      current.current = saved.token;
      setToken(saved.token);
      setState({ status: 'user', user: saved.user });
      try {
        const { user } = await authApi.me();
        if (current.current === saved.token) await remember({ token: saved.token, user });
      } catch {
        // 401 уже вызвал signOut через клиент; нет сети — остаёмся с сохранённым.
      }
    })();
  }, [signOut, remember]);

  const signIn = useCallback(async (email, password) => remember(await authApi.login(email, password)), [remember]);
  const signUp = useCallback(async (fields) => remember(await authApi.register(fields)), [remember]);

  const value = useMemo(() => ({ ...state, signIn, signUp, signOut }), [state, signIn, signUp, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

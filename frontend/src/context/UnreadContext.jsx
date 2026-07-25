import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from './AuthContext';

const UnreadContext = createContext({ unread: 0, refreshUnread: () => {} });

// Счётчик непрочитанных сообщений для значка в шапке. Обновляется при переходах
// между страницами, а страница переписки дёргает refreshUnread() сама после того,
// как сервер пометил входящие прочитанными — иначе значок «залипал» бы до
// следующего перехода (запрос счётчика и отметка о прочтении идут параллельно).
export function UnreadProvider({ children }) {
  const { token } = useAuth();
  const location = useLocation();
  const [unread, setUnread] = useState(0);

  const refreshUnread = useCallback(() => {
    if (!token) {
      setUnread(0);
      return;
    }
    api
      .unreadCount(token)
      .then(({ count }) => setUnread(count))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    refreshUnread();
  }, [refreshUnread, location.pathname]);

  return <UnreadContext.Provider value={{ unread, refreshUnread }}>{children}</UnreadContext.Provider>;
}

export function useUnread() {
  return useContext(UnreadContext);
}

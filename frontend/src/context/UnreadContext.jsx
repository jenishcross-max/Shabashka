import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from './AuthContext';

const UnreadContext = createContext({ unread: 0, newOffers: 0, refreshUnread: () => {} });

// Счётчики для значков в шапке: непрочитанные сообщения и новые отклики на мои
// задачи биржи — приходят одним запросом. Обновляются при переходах между
// страницами, а страницы переписки и задачи дёргают refreshUnread() сами после
// того, как сервер пометил прочитанное, — иначе значок «залипал» бы до
// следующего перехода (запрос счётчика и отметка о прочтении идут параллельно).
export function UnreadProvider({ children }) {
  const { token } = useAuth();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const [newOffers, setNewOffers] = useState(0);

  const refreshUnread = useCallback(() => {
    if (!token) {
      setUnread(0);
      setNewOffers(0);
      return;
    }
    api
      .unreadCount(token)
      .then(({ count, offers }) => {
        setUnread(count);
        setNewOffers(offers || 0);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    refreshUnread();
  }, [refreshUnread, location.pathname]);

  return (
    <UnreadContext.Provider value={{ unread, newOffers, refreshUnread }}>{children}</UnreadContext.Provider>
  );
}

export function useUnread() {
  return useContext(UnreadContext);
}

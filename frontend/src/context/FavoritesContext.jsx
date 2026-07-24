import { createContext, useContext, useEffect, useState } from 'react';

const FavoritesContext = createContext(null);
const STORAGE_KEY = 'shabashka_favorites';

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function FavoritesProvider({ children }) {
  const [ids, setIds] = useState(readStored);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }, [ids]);

  function toggle(orderId) {
    setIds((prev) => (prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]));
  }

  function isFavorite(orderId) {
    return ids.includes(orderId);
  }

  return (
    <FavoritesContext.Provider value={{ ids, toggle, isFavorite }}>{children}</FavoritesContext.Provider>
  );
}

export function useFavorites() {
  return useContext(FavoritesContext);
}

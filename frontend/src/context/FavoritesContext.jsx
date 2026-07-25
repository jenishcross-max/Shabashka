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

function key(type, id) {
  return `${type}:${id}`;
}

export function FavoritesProvider({ children }) {
  const [keys, setKeys] = useState(readStored);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  }, [keys]);

  function toggle(type, id) {
    const k = key(type, id);
    setKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  function isFavorite(type, id) {
    return keys.includes(key(type, id));
  }

  const orderIds = keys.filter((k) => k.startsWith('order:')).map((k) => Number(k.split(':')[1]));
  const vacancyIds = keys.filter((k) => k.startsWith('vacancy:')).map((k) => Number(k.split(':')[1]));

  return (
    <FavoritesContext.Provider value={{ keys, toggle, isFavorite, orderIds, vacancyIds }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites() {
  return useContext(FavoritesContext);
}

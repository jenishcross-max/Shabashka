import { useEffect, useState } from 'react';

// Совпадает ли медиазапрос сейчас — и перерисовка, когда перестаёт (повернули
// телефон, сузили окно).
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// Телефон — там, где фильтры перестают помещаться колонкой слева от списка
// (см. .orders-layout в index.css).
export const PHONE = '(max-width: 800px)';

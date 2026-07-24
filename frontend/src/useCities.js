import { useEffect, useState } from 'react';
import { api } from './api';

let cache = null;

export function useCities() {
  const [cities, setCities] = useState(cache || []);

  useEffect(() => {
    if (cache) return;
    api.cities().then(({ cities }) => {
      cache = cities;
      setCities(cities);
    });
  }, []);

  return cities;
}

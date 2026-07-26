const METRIKA_ID = import.meta.env.VITE_YANDEX_METRIKA_ID;

export function trackPageview(url) {
  if (!METRIKA_ID || !import.meta.env.PROD || typeof window.ym !== 'function') return;
  window.ym(METRIKA_ID, 'hit', url);
}

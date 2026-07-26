const METRIKA_ID = import.meta.env.VITE_YANDEX_METRIKA_ID;

export function initMetrika() {
  if (!METRIKA_ID || !import.meta.env.PROD) return;

  /* eslint-disable */
  (function (m, e, t, r, i, k, a) {
    m[i] =
      m[i] ||
      function () {
        (m[i].a = m[i].a || []).push(arguments);
      };
    m[i].l = 1 * new Date();
    (k = e.createElement(t)), (a = e.getElementsByTagName(t)[0]);
    k.async = 1;
    k.src = r;
    a.parentNode.insertBefore(k, a);
  })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
  /* eslint-enable */

  window.ym(METRIKA_ID, 'init', {
    ssr: true,
    webvisor: true,
    clickmap: true,
    ecommerce: 'dataLayer',
    accurateTrackBounce: true,
    trackLinks: true,
  });
}

export function trackPageview(url) {
  if (!METRIKA_ID || !import.meta.env.PROD || typeof window.ym !== 'function') return;
  window.ym(METRIKA_ID, 'hit', url);
}

import { useEffect } from 'react';

const DEFAULT_TITLE = 'Шабашка — заказы и подработка в Кыргызстане';
const DEFAULT_DESCRIPTION =
  'Доска объявлений для поиска подработки и мастеров в Кыргызстане. Разместите заказ или откликнитесь через WhatsApp — без комиссии.';

// Меняет <title> и meta[name=description] под конкретную страницу и
// возвращает дефолтные значения при уходе со страницы (SPA — index.html один на всех).
export function useMeta(title, description) {
  useEffect(() => {
    document.title = title || DEFAULT_TITLE;
    const tag = document.querySelector('meta[name="description"]');
    if (tag) tag.setAttribute('content', description || DEFAULT_DESCRIPTION);

    return () => {
      document.title = DEFAULT_TITLE;
      if (tag) tag.setAttribute('content', DEFAULT_DESCRIPTION);
    };
  }, [title, description]);
}

// Вставляет <script type="application/ld+json"> с структурированными данными
// (schema.org) для богатых сниппетов в поиске. Убирает скрипт при уходе со страницы.
export function useJsonLd(data) {
  useEffect(() => {
    if (!data) return undefined;
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify(data);
    document.head.appendChild(script);
    return () => script.remove();
  }, [data]);
}

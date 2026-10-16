import { QueryClient } from '@tanstack/react-query';

// Повторяем только то, что может пройти со второго раза: нет сети и 5xx (Render
// перезапускается). 4xx — ответ окончательный, повтор только задержит текст
// ошибки. Один раз: спящий Render и так отвечает до минуты.
export function shouldRetry(failureCount, error) {
  const status = error?.status;
  return failureCount < 1 && (status === 0 || status >= 500);
}

export function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: shouldRetry, staleTime: 30_000 } } });
}

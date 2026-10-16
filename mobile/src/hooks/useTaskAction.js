import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Что перечитать после действия с задачей или откликом: статус виден и на экране
// задачи, и в ленте (там только открытые), и в «Моё», и в значке новых откликов.
// Ждём только экран задачи: до свежего ответа его кнопки показывали бы прежний
// статус; остальное обновится в фоне.
export function refreshTask(queryClient, id) {
  for (const queryKey of [['tasks'], ['my-tasks'], ['my-offers'], ['unread']]) {
    queryClient.invalidateQueries({ queryKey });
  }
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['task', String(id)] }),
    queryClient.invalidateQueries({ queryKey: ['task-offers', String(id)] }),
  ]);
}

// Действие на экране задачи: пока идёт запрос — busy (второе нажатие не уйдёт),
// ошибка — текстом сервера. После успеха — и после 409: статус уже сменился
// в другом месте (вторая вкладка, модератор) — перечитываем задачу.
// run возвращает ответ сервера или undefined, если не вышло.
export function useTaskAction(id) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action) {
    setBusy(true);
    setError('');
    try {
      const result = await action();
      await refreshTask(queryClient, id);
      return result;
    } catch (e) {
      setError(e.message);
      if (e.status === 409) await refreshTask(queryClient, id);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, run };
}

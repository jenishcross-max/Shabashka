import { useQuery } from '@tanstack/react-query';
import { getTask } from '../api/tasks';
import { useAuth } from '../auth/AuthContext';

// Задача из GET /tasks/:id — общая для экрана задачи, формы отклика и правки.
// В ключе — кто смотрит: свой отклик и переписку сервер отдаёт только по токену,
// и ответ, полученный гостем, не должен достаться вошедшему. Пока вход
// восстанавливается из SecureStore, не спрашиваем: ответ был бы гостевым.
export function useTask(id) {
  const { status, user } = useAuth();
  return useQuery({
    queryKey: ['task', String(id), user?.id ?? null],
    queryFn: () => getTask(id),
    enabled: status !== 'loading',
  });
}

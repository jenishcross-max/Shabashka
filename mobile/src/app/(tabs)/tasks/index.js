import { useRouter } from 'expo-router';
import { useAuth } from '../../../auth/AuthContext';
import ExchangeHome from '../../../screens/ExchangeHome';

export default function TasksTab() {
  const router = useRouter();
  const { status } = useAuth();
  // Разместить задачу можно только вошедшему: гостя сначала ведём на вход.
  const onNew = () => router.push(status === 'user' ? '/tasks/new' : '/login');
  return (
    <ExchangeHome onOpen={(id) => router.push(`/tasks/${id}`)} onNew={onNew} onLogin={() => router.push('/login')} />
  );
}

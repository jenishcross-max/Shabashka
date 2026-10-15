import { useRouter } from 'expo-router';
import { useAuth } from '../../../auth/AuthContext';
import TasksFeed from '../../../screens/TasksFeed';

export default function TasksTab() {
  const router = useRouter();
  const { status } = useAuth();
  // Разместить задачу можно только вошедшему: гостя сначала ведём на вход.
  const onNew = () => router.push(status === 'user' ? '/tasks/new' : '/login');
  return <TasksFeed onOpen={(id) => router.push(`/tasks/${id}`)} onNew={onNew} />;
}

import { useRouter } from 'expo-router';
import TaskForm from '../../../screens/TaskForm';

export default function NewTaskRoute() {
  const router = useRouter();
  // replace: после публикации «назад» ведёт в ленту, а не в пустую форму.
  return <TaskForm onDone={(id) => router.replace(`/tasks/${id}`)} onLogin={() => router.push('/login')} />;
}

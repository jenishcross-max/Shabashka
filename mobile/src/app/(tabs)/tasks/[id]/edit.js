import { useLocalSearchParams, useRouter } from 'expo-router';
import TaskForm from '../../../../screens/TaskForm';
import { goBack } from '../../../../navigation';

export default function EditTaskRoute() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  return <TaskForm id={id} onDone={() => goBack(router)} onLogin={() => router.push('/login')} />;
}

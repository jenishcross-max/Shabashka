import { useLocalSearchParams, useRouter } from 'expo-router';
import TaskDetail from '../../../../screens/TaskDetail';

export default function TaskRoute() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  return (
    <TaskDetail
      id={id}
      onLogin={() => router.push('/login')}
      onOffer={() => router.push(`/tasks/${id}/offer`)}
      onChat={(chatId) => router.push(`/messages/${chatId}`)}
      onEdit={() => router.push(`/tasks/${id}/edit`)}
    />
  );
}

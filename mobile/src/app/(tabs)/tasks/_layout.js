import { Stack } from 'expo-router';
import { colors } from '../../../theme';

export default function TasksLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.text,
        headerStyle: { backgroundColor: colors.card },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Биржа услуг' }} />
      <Stack.Screen name="[id]/index" options={{ title: 'Задача' }} />
      <Stack.Screen name="[id]/offer" options={{ title: 'Отклик' }} />
      <Stack.Screen name="[id]/edit" options={{ title: 'Изменить задачу' }} />
      <Stack.Screen name="new" options={{ title: 'Новая задача' }} />
    </Stack>
  );
}

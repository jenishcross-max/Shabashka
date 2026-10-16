import { Stack } from 'expo-router';
import { colors } from '../../../theme';

// Свой стек, как у биржи: список переписок → переписка.
export default function MessagesLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.text,
        headerStyle: { backgroundColor: colors.card },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Сообщения' }} />
      <Stack.Screen name="[id]" options={{ title: 'Переписка' }} />
    </Stack>
  );
}

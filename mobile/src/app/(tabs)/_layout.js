import { Tabs } from 'expo-router/js-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '../../theme';

const icon =
  (name) =>
  ({ color, size }) => <Ionicons name={name} color={color} size={size} />;

// Пять вкладок; у биржи свой стек со своей шапкой (лента → задача → отклик),
// у остальных пока одна страница — шапку рисует сама вкладка.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.red,
        tabBarInactiveTintColor: colors.muted,
        headerTintColor: colors.text,
        headerStyle: { backgroundColor: colors.card },
      }}
    >
      <Tabs.Screen name="tasks" options={{ title: 'Биржа', headerShown: false, tabBarIcon: icon('hammer-outline') }} />
      <Tabs.Screen name="orders" options={{ title: 'Заказы', tabBarIcon: icon('list-outline') }} />
      <Tabs.Screen name="vacancies" options={{ title: 'Вакансии', tabBarIcon: icon('briefcase-outline') }} />
      <Tabs.Screen name="messages" options={{ title: 'Сообщения', tabBarIcon: icon('chatbubbles-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Профиль', tabBarIcon: icon('person-outline') }} />
    </Tabs>
  );
}

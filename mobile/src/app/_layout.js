import { useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../auth/AuthContext';
import { createQueryClient } from '../queryClient';
import { colors } from '../theme';

// Корень: кэш запросов и вход — общие для всех экранов. Вход и регистрация —
// модальные окна поверх вкладок: после них человек возвращается туда, где был.
export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerTintColor: colors.text,
            headerStyle: { backgroundColor: colors.card },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ presentation: 'modal', title: 'Вход' }} />
          <Stack.Screen name="register" options={{ presentation: 'modal', title: 'Регистрация' }} />
        </Stack>
      </AuthProvider>
    </QueryClientProvider>
  );
}

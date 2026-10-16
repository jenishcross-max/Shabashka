import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

// Бесплатный Render засыпает без запросов, и первый ответ идёт до минуты. Без
// пояснения человек решит, что приложение зависло, — поэтому через 5 секунд
// объясняем, что происходит.
const SLOW_MS = 5000;

export default function Loading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.wrap}>
      <ActivityIndicator size="large" color={colors.red} />
      {slow ? <Text style={styles.text}>Сервер просыпается, это до минуты…</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 48, alignItems: 'center' },
  text: { marginTop: 14, color: colors.muted, fontSize: 14, textAlign: 'center' },
});

import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

// Заглушка раздела, который ещё не сделан (этап B плана docs/plans/2026-10-15-android.md).
export default function ComingSoon({ children }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { color: colors.muted, fontSize: 16, textAlign: 'center', lineHeight: 22 },
});

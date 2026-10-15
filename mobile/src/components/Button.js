import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../theme';

// busy — запрос уже ушёл: второе нажатие не отправит его ещё раз.
export default function Button({ title, onPress, busy = false, disabled = false, kind = 'primary', style }) {
  const off = busy || disabled;
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.base, primary ? styles.primary : styles.secondary, (pressed || off) && styles.dim, style]}
    >
      {busy ? <ActivityIndicator size="small" color={primary ? '#fff' : colors.red} style={styles.spinner} /> : null}
      <Text style={[styles.text, primary ? styles.primaryText : styles.secondaryText]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 18,
  },
  primary: { backgroundColor: colors.red },
  secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.redBorder },
  dim: { opacity: 0.7 },
  spinner: { marginRight: 8 },
  text: { fontSize: 16, fontWeight: '700' },
  primaryText: { color: '#fff' },
  secondaryText: { color: colors.red },
});

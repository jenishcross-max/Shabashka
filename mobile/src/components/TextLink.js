import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../theme';

// Второстепенное действие — подчёркнутый серый текст вместо кнопки, как .link-btn
// на сайте: «Пожаловаться» не должно спорить с «Выбрать исполнителем».
export default function TextLink({ title, onPress, disabled = false, style }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.link, (pressed || disabled) && styles.dim, style]}
    >
      <Text style={styles.text}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 12 },
  dim: { opacity: 0.6 },
  text: { fontSize: 14, color: colors.muted, textDecorationLine: 'underline' },
});

import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { colors } from '../theme';

// Каркас экрана-формы: прокрутка, клавиатура не закрывает поле ввода, нажатие
// на кнопку не тратится на то, чтобы спрятать клавиатуру.
export default function FormScreen({ title, subtitle, children }) {
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Ошибка сервера над кнопкой отправки.
export function FormError({ children }) {
  return children ? <Text style={styles.error}>{children}</Text> : null;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, marginBottom: 6 },
  subtitle: { fontSize: 14, color: colors.muted, marginBottom: 20 },
  error: {
    color: colors.redStatusText,
    backgroundColor: colors.redStatusBg,
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
    fontSize: 14,
  },
});

import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme';

// Поле формы с подписью. Подпись же — accessibilityLabel: по ней поле находят
// и экранный диктор, и тесты.
export default function Field({ label, hint, multiline, ...input }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.mutedLight}
        multiline={multiline}
        style={[styles.input, multiline && styles.multiline]}
        {...input}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  hint: { fontSize: 12, color: colors.muted, marginTop: 4 },
});

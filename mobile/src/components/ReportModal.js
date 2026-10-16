import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import Field from './Field';
import Button from './Button';
import { FormError } from './FormScreen';
import { colors } from '../theme';

// Окно жалобы с причиной. Alert.prompt на Android нет — поэтому своё окно.
// send(reason) — запрос; после успеха — onSent(), иначе текст сервера здесь же.
// Показывать, только пока жалоба пишется: каждое открытие — с чистого листа.
export default function ReportModal({ title, placeholder, send, onSent, onClose }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    setBusy(true);
    try {
      await send(reason.trim());
      onSent();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <Field
            label="Причина"
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={500}
            placeholder={placeholder}
          />
          <FormError>{error}</FormError>
          <Button title="Отправить" busy={busy} disabled={!reason.trim()} onPress={submit} />
          <Button title="Отмена" kind="secondary" onPress={onClose} style={styles.gap} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 12 },
  gap: { marginTop: 10 },
});

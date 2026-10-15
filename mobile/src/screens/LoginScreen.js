import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import Field from '../components/Field';
import Button from '../components/Button';
import FormScreen, { FormError } from '../components/FormScreen';
import { colors } from '../theme';

// onDone — вернуть человека туда, откуда его позвали войти (откликнуться,
// разместить задачу, открыть сообщения).
export default function LoginScreen({ onDone, onRegister }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <FormScreen title="Вход" subtitle="Тот же аккаунт, что на шабашка.com">
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <Field label="Пароль" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
      <FormError>{error}</FormError>
      <Button title="Войти" busy={busy} onPress={submit} />
      <Pressable onPress={onRegister} style={styles.linkWrap}>
        <Text style={styles.link}>Нет аккаунта? Зарегистрироваться</Text>
      </Pressable>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  linkWrap: { marginTop: 18, alignItems: 'center' },
  link: { color: colors.red, fontSize: 15, fontWeight: '600' },
});

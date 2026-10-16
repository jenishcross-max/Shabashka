import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import Field from '../components/Field';
import Button from '../components/Button';
import FormScreen, { FormError } from '../components/FormScreen';
import { SITE_URL } from '../config';
import { colors } from '../theme';

// Те же поля, что на сайте. Проверяет их сервер (routes/auth.js) — экран только
// показывает его ответ: так правила не разъедутся между сайтом и приложением.
export default function RegisterScreen({ onDone, onLogin }) {
  const { signUp } = useAuth();
  const [fields, setFields] = useState({ name: '', email: '', phone: '', password: '', city: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (value) => setFields((f) => ({ ...f, [key]: value }));

  async function submit() {
    setError('');
    setBusy(true);
    try {
      await signUp({ ...fields, email: fields.email.trim() });
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <FormScreen title="Регистрация" subtitle="Аккаунт подходит и для сайта шабашка.com">
      <Field label="Имя" value={fields.name} onChangeText={set('name')} autoComplete="name" />
      <Field
        label="Email"
        value={fields.email}
        onChangeText={set('email')}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        hint="Пришлём письмо, чтобы подтвердить почту"
      />
      <Field
        label="WhatsApp"
        value={fields.phone}
        onChangeText={set('phone')}
        keyboardType="phone-pad"
        placeholder="+996 700 000 000"
        hint="Публично не показывается — только собеседнику в переписке"
      />
      <Field
        label="Пароль"
        value={fields.password}
        onChangeText={set('password')}
        secureTextEntry
        autoComplete="new-password"
        hint="Не короче 8 символов"
      />
      <Field label="Город" value={fields.city} onChangeText={set('city')} placeholder="Бишкек" />
      <FormError>{error}</FormError>
      <Button title="Зарегистрироваться" busy={busy} onPress={submit} />
      <Pressable onPress={() => Linking.openURL(`${SITE_URL}/privacy`)} style={styles.linkWrap}>
        <Text style={styles.note}>
          Регистрируясь, вы соглашаетесь с <Text style={styles.link}>политикой конфиденциальности</Text>
        </Text>
      </Pressable>
      <Pressable onPress={onLogin} style={styles.linkWrap}>
        <Text style={styles.link}>Уже есть аккаунт? Войти</Text>
      </Pressable>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  linkWrap: { marginTop: 16, alignItems: 'center' },
  note: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  link: { color: colors.red, fontSize: 15, fontWeight: '600' },
});

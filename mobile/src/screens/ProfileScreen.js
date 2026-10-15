import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import Button from '../components/Button';
import Loading from '../components/Loading';
import { colors } from '../theme';

// Профиль первой сборки: кто вошёл и выход. Подтверждение почты, ссылки на сайт
// и удаление аккаунта — Task 16 и 20 плана.
export default function ProfileScreen({ onLogin, onRegister }) {
  const { status, user, signOut } = useAuth();
  if (status === 'loading') return <Loading />;

  if (status === 'guest') {
    return (
      <View style={styles.wrap}>
        <Text style={styles.lead}>Войдите, чтобы откликаться на задачи, размещать свои и писать сообщения.</Text>
        <Button title="Войти" onPress={onLogin} />
        <Button title="Зарегистрироваться" kind="secondary" onPress={onRegister} style={styles.gap} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.name}>{user.name}</Text>
      <Text style={styles.email}>{user.email}</Text>
      {user.emailVerified ? null : (
        <Text style={styles.warn}>Почта не подтверждена — без этого можно разместить только одну задачу или объявление. Ссылка — в письме.</Text>
      )}
      <Button title="Выйти" kind="secondary" onPress={signOut} style={styles.gap} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  lead: { fontSize: 16, color: colors.text, marginBottom: 20, lineHeight: 22 },
  name: { fontSize: 22, fontWeight: '800', color: colors.text },
  email: { fontSize: 15, color: colors.muted, marginTop: 4 },
  warn: {
    marginTop: 14,
    color: colors.redStatusText,
    backgroundColor: colors.redStatusBg,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
  },
  gap: { marginTop: 12 },
});

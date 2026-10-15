import { useRouter } from 'expo-router';
import LoginScreen from '../screens/LoginScreen';
import { goBack } from '../navigation';

export default function Login() {
  const router = useRouter();
  return <LoginScreen onDone={() => goBack(router)} onRegister={() => router.replace('/register')} />;
}

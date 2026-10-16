import { useRouter } from 'expo-router';
import RegisterScreen from '../screens/RegisterScreen';
import { goBack } from '../navigation';

export default function Register() {
  const router = useRouter();
  return <RegisterScreen onDone={() => goBack(router)} onLogin={() => router.replace('/login')} />;
}

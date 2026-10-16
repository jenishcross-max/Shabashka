import { useRouter } from 'expo-router';
import ProfileScreen from '../../screens/ProfileScreen';

export default function ProfileTab() {
  const router = useRouter();
  return <ProfileScreen onLogin={() => router.push('/login')} onRegister={() => router.push('/register')} />;
}

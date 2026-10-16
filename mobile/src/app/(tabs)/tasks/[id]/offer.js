import { useLocalSearchParams, useRouter } from 'expo-router';
import OfferForm from '../../../../screens/OfferForm';
import { goBack } from '../../../../navigation';

export default function OfferRoute() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  return <OfferForm id={id} onDone={() => goBack(router)} />;
}

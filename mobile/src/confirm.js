import { Alert } from 'react-native';

// Подтверждение перед шагом, который не отменить, — системный диалог Android.
// «Нет», а не «Отмена»: рядом с «Отменить задачу» «Отмена» читалась бы двояко.
export function confirm({ title, message, action, destructive = false, onConfirm }) {
  Alert.alert(title, message, [
    { text: 'Нет', style: 'cancel' },
    { text: action, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

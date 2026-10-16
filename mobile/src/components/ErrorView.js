import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import { colors } from '../theme';

// Текст ошибки — как прислал сервер (или «Нет связи с сервером» от клиента API).
export default function ErrorView({ error, onRetry }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>{error?.message || 'Что-то пошло не так'}</Text>
      {onRetry ? <Button title="Повторить" kind="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 40, paddingHorizontal: 24, alignItems: 'center' },
  text: { color: colors.text, fontSize: 15, textAlign: 'center', marginBottom: 16 },
});

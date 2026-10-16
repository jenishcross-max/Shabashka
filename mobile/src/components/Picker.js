import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

// Выбор из списка в нижнем листе — категория в фильтрах ленты и в форме задачи.
// options — [{ value, label }]; выбранный пункт выделен.
export default function Picker({ visible, title, options, value, onPick, onClose }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <FlatList
            data={options}
            keyExtractor={(item) => item.value || 'all'}
            renderItem={({ item }) => (
              <Pressable onPress={() => onPick(item.value)} style={styles.option}>
                <Text style={[styles.optionText, item.value === value && styles.optionActive]}>{item.label}</Text>
              </Pressable>
            )}
          />
          <Pressable onPress={onClose} style={styles.option}>
            <Text style={styles.cancel}>Закрыть</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '75%', paddingTop: 16 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, paddingHorizontal: 20, marginBottom: 8 },
  option: { paddingHorizontal: 20, paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.border },
  optionText: { fontSize: 16, color: colors.text },
  optionActive: { color: colors.red, fontWeight: '700' },
  cancel: { fontSize: 16, color: colors.muted, textAlign: 'center' },
});

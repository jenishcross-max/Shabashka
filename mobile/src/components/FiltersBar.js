import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { listCategories } from '../api/catalog';
import { colors } from '../theme';

// Поиск, категория и город над лентой. Поиск и город применяются по Enter, а не
// на каждую букву: иначе каждое нажатие — запрос к серверу.
export default function FiltersBar({ filters, onChange }) {
  const [q, setQ] = useState(filters.q);
  const [city, setCity] = useState(filters.city);
  const [picking, setPicking] = useState(false);
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: Infinity });

  const pick = (category) => {
    setPicking(false);
    onChange({ ...filters, category });
  };

  return (
    <View style={styles.wrap}>
      <TextInput
        accessibilityLabel="Поиск"
        placeholder="Поиск: что нужно сделать"
        placeholderTextColor={colors.mutedLight}
        value={q}
        onChangeText={setQ}
        onSubmitEditing={() => onChange({ ...filters, q: q.trim() })}
        returnKeyType="search"
        style={styles.input}
      />
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setPicking(true)}
          style={[styles.chip, filters.category && styles.chipActive]}
        >
          <Text style={[styles.chipText, filters.category && styles.chipTextActive]} numberOfLines={1}>
            Категория: {filters.category || 'все'}
          </Text>
        </Pressable>
        <TextInput
          accessibilityLabel="Город"
          placeholder="Город"
          placeholderTextColor={colors.mutedLight}
          value={city}
          onChangeText={setCity}
          onSubmitEditing={() => onChange({ ...filters, city: city.trim() })}
          returnKeyType="search"
          style={[styles.input, styles.city]}
        />
      </View>

      <Modal visible={picking} animationType="slide" transparent onRequestClose={() => setPicking(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Категория</Text>
            <FlatList
              data={['', ...(categories.data?.categories || [])]}
              keyExtractor={(item) => item || 'all'}
              renderItem={({ item }) => (
                <Pressable onPress={() => pick(item)} style={styles.option}>
                  <Text style={[styles.optionText, item === filters.category && styles.optionActive]}>
                    {item || 'Все категории'}
                  </Text>
                </Pressable>
              )}
            />
            <Pressable onPress={() => setPicking(false)} style={styles.option}>
              <Text style={styles.cancel}>Закрыть</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    color: colors.text,
  },
  row: { flexDirection: 'row', gap: 8, marginTop: 8 },
  chip: {
    flex: 1,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
  },
  chipActive: { borderColor: colors.red, backgroundColor: colors.redTint },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextActive: { color: colors.redDark, fontWeight: '600' },
  city: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '75%', paddingTop: 16 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.text, paddingHorizontal: 20, marginBottom: 8 },
  option: { paddingHorizontal: 20, paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.border },
  optionText: { fontSize: 16, color: colors.text },
  optionActive: { color: colors.red, fontWeight: '700' },
  cancel: { fontSize: 16, color: colors.muted, textAlign: 'center' },
});

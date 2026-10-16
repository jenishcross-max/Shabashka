import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

// Переключатель из двух-трёх вкладок внутри экрана: «Все задачи / Моё»,
// «Мои задачи / Мои отклики». items — [{ value, label, badge }]; badge > 0 —
// красный кружок с числом (новые отклики).
export default function Segmented({ items, value, onChange, style }) {
  return (
    <View accessibilityRole="tablist" style={[styles.wrap, style]}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(item.value)}
            style={[styles.item, active && styles.active]}
          >
            <Text style={[styles.text, active && styles.activeText]}>{item.label}</Text>
            {item.badge > 0 ? <Text style={styles.badge}>{item.badge}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 10, padding: 3 },
  item: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
  },
  active: { backgroundColor: colors.card },
  text: { fontSize: 15, color: colors.muted, fontWeight: '600' },
  activeText: { color: colors.text },
  badge: {
    minWidth: 20,
    backgroundColor: colors.red,
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 5,
    borderRadius: 10,
    overflow: 'hidden',
  },
});

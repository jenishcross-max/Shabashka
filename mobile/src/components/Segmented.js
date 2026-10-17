import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

// Переключатель из двух-трёх вкладок внутри экрана: «Все задачи / Моё»,
// «Мои задачи / Мои отклики». items — [{ value, label, badge }]; badge > 0 —
// красный кружок с числом (новые отклики). kind: 'pills' — плашки на сером фоне
// (верхний уровень), 'tabs' — вкладки с подчёркиванием, когда переключатель
// стоит под другим и не должен с ним сливаться.
export default function Segmented({ items, value, onChange, kind = 'pills', style }) {
  const tabs = kind === 'tabs';
  return (
    <View accessibilityRole="tablist" style={[tabs ? styles.tabsWrap : styles.wrap, style]}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(item.value)}
            style={[styles.item, tabs ? styles.tab : styles.pill, active && (tabs ? styles.activeTab : styles.active)]}
          >
            <Text style={[styles.text, active && (tabs ? styles.activeTabText : styles.activeText)]}>{item.label}</Text>
            {item.badge > 0 ? <Text style={styles.badge}>{item.badge}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 10, padding: 3 },
  tabsWrap: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border },
  item: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  pill: { paddingVertical: 8, borderRadius: 8 },
  active: { backgroundColor: colors.card },
  // Подчёркивание ложится на общую линию снизу, а не под неё.
  tab: { paddingVertical: 10, borderBottomWidth: 2, borderColor: 'transparent', marginBottom: -1 },
  activeTab: { borderColor: colors.red },
  text: { fontSize: 15, color: colors.muted, fontWeight: '600' },
  activeText: { color: colors.text },
  activeTabText: { color: colors.red },
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

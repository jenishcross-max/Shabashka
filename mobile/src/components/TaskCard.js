import { Pressable, StyleSheet, Text, View } from 'react-native';
import { taskBudget, offersLine } from '../exchange';
import { relativeDate } from '../format';
import { colors } from '../theme';

// Карточка задачи биржи — как frontend/src/components/TaskCard.jsx: категория,
// формат, город, бюджет и число откликов (по нему исполнитель понимает, стоит
// ли ещё предлагать цену).
export default function TaskCard({ task, onPress }) {
  const online = task.work_format === 'online';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.top}>
        <View style={styles.badges}>
          <Text style={styles.badge}>{task.category}</Text>
          <Text style={[styles.badge, styles.format]}>{online ? 'Онлайн' : 'Офлайн'}</Text>
        </View>
        {online ? null : <Text style={styles.city}>{task.city}</Text>}
      </View>
      <Text style={styles.title}>{task.title}</Text>
      <Text style={styles.description} numberOfLines={2}>
        {task.description}
      </Text>
      <View style={styles.bottom}>
        <Text style={[styles.budget, !task.budget && styles.noBudget]}>{taskBudget(task)}</Text>
        <Text style={styles.meta}>
          {offersLine(task.offers_count)} · {relativeDate(task.created_at)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  pressed: { opacity: 0.85 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  badges: { flexDirection: 'row', flexShrink: 1, flexWrap: 'wrap', gap: 6 },
  badge: {
    backgroundColor: colors.redTint,
    color: colors.redDark,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  format: { backgroundColor: colors.bg, color: colors.muted },
  city: { color: colors.muted, fontSize: 13, marginLeft: 8 },
  title: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 4 },
  description: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  bottom: { marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  budget: { fontSize: 15, fontWeight: '700', color: colors.text, flexShrink: 1 },
  noBudget: { fontWeight: '500', color: colors.muted },
  meta: { fontSize: 12, color: colors.mutedLight },
});

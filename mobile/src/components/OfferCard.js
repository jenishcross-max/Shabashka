import { StyleSheet, Text, View } from 'react-native';
import { som, trustLine } from '../exchange';
import { colors } from '../theme';

// Отклик: цена, срок и что сделает исполнитель. У заказчика — имя, «Новый» и то,
// по чему выбирать, пока отзывов нет (trustLine). mine — свой отклик у
// исполнителя: вместо имени «Ваш отклик» и состояние словом (label). children — кнопки.
export default function OfferCard({ offer, mine = false, label, children }) {
  return (
    <View style={[styles.card, offer.status === 'accepted' && styles.chosen]}>
      <View style={styles.head}>
        <View style={styles.who}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{mine ? 'Ваш отклик' : offer.user_name}</Text>
            {offer.is_new ? <Text style={styles.new}>Новый</Text> : null}
          </View>
          {mine ? null : <Text style={styles.label}>{trustLine(offer)}</Text>}
          {label ? <Text style={styles.label}>{label}</Text> : null}
        </View>
        <Text style={styles.price}>{som(offer.price)}</Text>
      </View>
      <Text style={styles.term}>Срок: {offer.term}</Text>
      <Text style={styles.comment}>{offer.comment}</Text>
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginTop: 10,
  },
  chosen: { borderColor: colors.greenText },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  who: { flexShrink: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  new: {
    backgroundColor: colors.red,
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  label: { fontSize: 13, color: colors.muted, marginTop: 2 },
  price: { fontSize: 17, fontWeight: '800', color: colors.text },
  term: { fontSize: 14, color: colors.muted, marginTop: 6 },
  comment: { fontSize: 15, color: colors.text, marginTop: 6, lineHeight: 21 },
  actions: { marginTop: 12, gap: 8 },
});

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { acceptOffer, cancelTask, doneTask, listOffers, reportOffer, unassignTask } from '../api/tasks';
import { useTaskAction } from '../hooks/useTaskAction';
import { confirm } from '../confirm';
import Loading from '../components/Loading';
import ErrorView from '../components/ErrorView';
import Button from '../components/Button';
import OfferCard from '../components/OfferCard';
import ReportModal from '../components/ReportModal';
import { FormError } from '../components/FormScreen';
import { som } from '../exchange';
import { colors } from '../theme';

const REPORT_SENT = 'Жалоба отправлена — разберём в ближайшее время';

// Нижняя часть экрана задачи у заказчика: отклики целиком (их видит только он),
// выбор исполнителя и шаги по статусу задачи. Всё необратимое — с подтверждением.
// chatId — переписка с выбранным; onChat(id) — открыть её, onEdit — правка задачи.
export default function TaskOffers({ task, chatId, onChat, onEdit }) {
  const queryClient = useQueryClient();
  const action = useTaskAction(task.id);
  const [reporting, setReporting] = useState(null);
  const [reported, setReported] = useState(false);
  const offers = useQuery({
    queryKey: ['task-offers', String(task.id)],
    queryFn: async () => {
      const data = await listOffers(task.id);
      // Сервер пометил отклики увиденными — значок новых откликов пора перечитать.
      queryClient.invalidateQueries({ queryKey: ['unread'] });
      return data;
    },
  });

  if (offers.isPending) return <Loading />;
  if (offers.isError) return <ErrorView error={offers.error} onRetry={() => offers.refetch()} />;
  const list = offers.data.offers;
  const chosen = list.find((o) => o.status === 'accepted');

  const accept = (offer) =>
    confirm({
      title: 'Выбрать исполнителя?',
      message:
        `${offer.user_name} за ${som(offer.price)}. Новые отклики перестанут приниматься, ` +
        'остальные увидят, что выбран другой исполнитель.',
      action: 'Выбрать',
      onConfirm: async () => {
        const result = await action.run(() => acceptOffer(task.id, offer.id));
        if (result) onChat(result.conversation_id);
      },
    });

  const cancel = () =>
    confirm({
      title: 'Отменить задачу?',
      message: 'Она пропадёт из ленты, а откликнувшиеся увидят, что задача отменена.',
      action: 'Отменить задачу',
      destructive: true,
      onConfirm: () => action.run(() => cancelTask(task.id)),
    });

  const done = () =>
    confirm({
      title: 'Задача выполнена?',
      message: 'Задача закроется, а исполнителю засчитается выполненная работа.',
      action: 'Выполнена',
      onConfirm: () => action.run(() => doneTask(task.id)),
    });

  const unassign = () =>
    confirm({
      title: 'Отменить выбор?',
      message: `Задача снова откроется для откликов, а ${chosen.user_name} не сможет откликнуться на неё снова.`,
      action: 'Отменить выбор',
      destructive: true,
      onConfirm: () => action.run(() => unassignTask(task.id)),
    });

  const report = reporting ? (
    <ReportModal
      title="Что не так с этим откликом?"
      placeholder="Например: просит предоплату"
      send={(reason) => reportOffer(task.id, reporting.id, reason)}
      onSent={() => {
        setReporting(null);
        setReported(true);
      }}
      onClose={() => setReporting(null)}
    />
  ) : null;

  const notes = (
    <>
      <FormError>{action.error}</FormError>
      {reported ? <Text style={styles.sent}>{REPORT_SENT}</Text> : null}
    </>
  );

  const cancelButton = (
    <Button title="Отменить задачу" kind="secondary" busy={action.busy} onPress={cancel} style={styles.gap} />
  );

  if (task.status === 'done') {
    return <Text style={styles.note}>Задача выполнена{chosen ? `. Исполнитель: ${chosen.user_name}` : ''}.</Text>;
  }
  if (task.status === 'cancelled') return <Text style={styles.note}>Задача отменена.</Text>;

  if (task.status === 'assigned') {
    return (
      <View>
        {notes}
        <Text style={styles.heading}>Ваш исполнитель</Text>
        {chosen ? (
          <OfferCard offer={chosen}>
            {chatId ? <Button title="Написать исполнителю" onPress={() => onChat(chatId)} /> : null}
            <Button title="Задача выполнена" kind="secondary" busy={action.busy} onPress={done} />
            <Button title="Отменить выбор" kind="secondary" busy={action.busy} onPress={unassign} />
          </OfferCard>
        ) : null}
        {cancelButton}
      </View>
    );
  }

  return (
    <View>
      {notes}
      <Text style={styles.heading}>Отклики ({list.length})</Text>
      {list.length === 0 ? (
        <Text style={styles.note}>Откликов пока нет. Когда исполнители предложат цену, они появятся здесь.</Text>
      ) : null}
      {list.map((offer) => (
        <OfferCard key={offer.id} offer={offer}>
          <Button title="Выбрать исполнителем" busy={action.busy} onPress={() => accept(offer)} />
          <Button title="Пожаловаться" kind="secondary" onPress={() => setReporting(offer)} />
        </OfferCard>
      ))}
      <Button title="Изменить задачу" kind="secondary" disabled={action.busy} onPress={onEdit} style={styles.gap} />
      {cancelButton}
      {report}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 18, fontWeight: '800', color: colors.text },
  note: { fontSize: 15, color: colors.muted, marginTop: 8, lineHeight: 21 },
  sent: {
    fontSize: 14,
    color: colors.greenText,
    backgroundColor: colors.greenBg,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  gap: { marginTop: 12 },
});

import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { reportTask, withdrawOffer } from '../api/tasks';
import { useAuth } from '../auth/AuthContext';
import { useTask } from '../hooks/useTask';
import { useTaskAction } from '../hooks/useTaskAction';
import { confirm } from '../confirm';
import Loading from '../components/Loading';
import ErrorView from '../components/ErrorView';
import Button from '../components/Button';
import { FormError } from '../components/FormScreen';
import OfferCard from '../components/OfferCard';
import ReportModal from '../components/ReportModal';
import TextLink from '../components/TextLink';
import TaskOffers from './TaskOffers';
import { OFFER_STATE_LABELS, TASK_STATUS_LABELS, isActiveStatus, taskBudget } from '../exchange';
import { offerWord, relativeDate, viewWord } from '../format';
import { colors } from '../theme';

// Экран задачи биржи — один на троих, как на сайте (frontend/src/pages/TaskDetail.jsx):
// задача у всех одна, разница в нижнем блоке. Заказчик видит отклики целиком,
// исполнитель — только свой, гость — их число. Роль считаем здесь лишь для выбора
// блока: что можно, а что нет, всё равно решает сервер.

// Что исполнитель видит про свой отклик (состояние — словом с сервера).
const MY_OFFER_NOTES = {
  done: 'Задача выполнена. Спасибо за работу!',
  other: 'Заказчик выбрал другого исполнителя.',
  cancelled: 'Заказчик отменил задачу.',
  withdrawn: 'Вы отозвали отклик.',
  dropped: 'Заказчик отменил выбор. Откликнуться на эту задачу снова нельзя.',
  removed: 'Ваш отклик снят модератором.',
};

const CLOSED_NOTES = {
  assigned: 'Исполнитель уже выбран — новые отклики не принимаются.',
  done: 'Задача выполнена.',
  cancelled: 'Задача отменена заказчиком.',
};

function MetaLine({ icon, children }) {
  return (
    <View style={styles.metaLine}>
      <Ionicons name={icon} size={16} color={colors.muted} />
      <Text style={styles.metaText}>{children}</Text>
    </View>
  );
}

function OffersCount({ n }) {
  return (
    <Text style={styles.note}>
      {n > 0 ? `${n} ${offerWord(n)} на эту задачу` : 'Откликов пока нет — ваш может стать первым'}
    </Text>
  );
}

function WorkerPanel({ task, myOffer, chatId, guest, onLogin, onOffer, onChat }) {
  const action = useTaskAction(task.id);
  const open = task.status === 'open';

  const withdraw = () =>
    confirm({
      title: 'Отозвать отклик?',
      message: 'Заказчик его больше не увидит.',
      action: 'Отозвать',
      destructive: true,
      onConfirm: () => action.run(() => withdrawOffer(task.id)),
    });

  if (guest) {
    if (!open) return <Text style={styles.note}>{CLOSED_NOTES[task.status]}</Text>;
    return (
      <View>
        <Text style={styles.heading}>Предложить свою цену</Text>
        <OffersCount n={task.offers_count} />
        <Button title="Войдите, чтобы откликнуться" onPress={onLogin} style={styles.gap} />
      </View>
    );
  }

  const state = myOffer?.state;
  if (state === 'chosen') {
    return (
      <View>
        <Text style={styles.heading}>Заказчик выбрал вас исполнителем</Text>
        <Text style={styles.note}>Договоритесь о деталях в переписке — там же телефон заказчика.</Text>
        {chatId ? <Button title="Перейти к переписке" onPress={() => onChat(chatId)} style={styles.gap} /> : null}
      </View>
    );
  }

  if (myOffer) {
    return (
      <View>
        {state === 'waiting' ? <OffersCount n={task.offers_count} /> : null}
        <OfferCard offer={myOffer} mine label={OFFER_STATE_LABELS[state]}>
          {state === 'waiting' ? (
            <View style={styles.row}>
              <Button title="Изменить" kind="secondary" disabled={action.busy} onPress={onOffer} style={styles.half} />
              <Button title="Отозвать" kind="secondary" busy={action.busy} onPress={withdraw} style={styles.half} />
            </View>
          ) : null}
        </OfferCard>
        <FormError>{action.error}</FormError>
        {MY_OFFER_NOTES[state] ? <Text style={styles.note}>{MY_OFFER_NOTES[state]}</Text> : null}
        {state === 'withdrawn' && open ? (
          <Button title="Откликнуться снова" kind="secondary" onPress={onOffer} style={styles.gap} />
        ) : null}
      </View>
    );
  }

  if (!open) return <Text style={styles.note}>{CLOSED_NOTES[task.status]}</Text>;
  return (
    <View>
      <Text style={styles.heading}>Предложить свою цену</Text>
      <OffersCount n={task.offers_count} />
      <Button title="Откликнуться" onPress={onOffer} style={styles.gap} />
    </View>
  );
}

// Жалоба на задачу — от всех, кроме заказчика, и без входа, как у заказов.
function ReportTask({ task }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  if (sent) return <Text style={styles.sent}>Жалоба отправлена — разберём в ближайшее время</Text>;
  return (
    <>
      <TextLink title="Пожаловаться на задачу" onPress={() => setOpen(true)} />
      {open ? (
        <ReportModal
          title="Что не так с этой задачей?"
          placeholder="Например: просят предоплату или работа за границей"
          send={(reason) => reportTask(task.id, reason)}
          onSent={() => {
            setOpen(false);
            setSent(true);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

// Переходы — колбэками: onLogin, onOffer (форма отклика), onChat(id переписки), onEdit.
export default function TaskDetail({ id, onLogin, onOffer, onChat, onEdit }) {
  const { status, user } = useAuth();
  const query = useTask(id);

  if (query.isPending) return <Loading />;
  if (query.isError) {
    // 404 повтором не исправить — кнопку «Повторить» показываем только для сбоев.
    const retry = query.error.status === 404 ? null : () => query.refetch();
    return <ErrorView error={query.error} onRetry={retry} />;
  }

  const { task, my_offer: myOffer, conversation_id: chatId } = query.data;
  const isOwner = user?.id === task.user_id;
  const online = task.work_format === 'online';
  const active = isActiveStatus(task.status);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} colors={[colors.red]} />
      }
    >
      <View style={styles.card}>
        <View style={styles.badges}>
          <Text style={styles.badge}>{task.category}</Text>
          <Text style={[styles.badge, active ? styles.statusOpen : styles.statusClosed]}>
            {TASK_STATUS_LABELS[task.status]}
          </Text>
        </View>
        <Text style={styles.title}>{task.title}</Text>
        <MetaLine icon={online ? 'globe-outline' : 'location-outline'}>
          {online ? 'Онлайн' : `${task.city}${task.address ? `, ${task.address}` : ''}`}
        </MetaLine>
        {task.when_text ? <MetaLine icon="time-outline">Когда: {task.when_text}</MetaLine> : null}
        <MetaLine icon="calendar-outline">Опубликована {relativeDate(task.created_at)}</MetaLine>
        <MetaLine icon="person-outline">Заказчик: {task.owner_name}</MetaLine>
        <MetaLine icon="eye-outline">
          {task.views} {viewWord(task.views)}
        </MetaLine>

        <View style={styles.budgetBox}>
          <Text style={styles.budgetLabel}>Бюджет заказчика</Text>
          <Text style={[styles.budget, !task.budget && styles.noBudget]}>{taskBudget(task)}</Text>
        </View>

        <Text style={styles.heading}>Описание задачи</Text>
        <Text style={styles.description}>{task.description}</Text>
      </View>

      <View style={styles.card}>
        {isOwner ? (
          <TaskOffers task={task} chatId={chatId} onChat={onChat} onEdit={onEdit} />
        ) : (
          <WorkerPanel
            task={task}
            myOffer={myOffer}
            chatId={chatId}
            guest={status !== 'user'}
            onLogin={onLogin}
            onOffer={onOffer}
            onChat={onChat}
          />
        )}
      </View>

      <Text style={styles.safety}>
        Не переводите деньги вперёд — ни «за материалы», ни «за бронь», ни «за оформление». Шабашка не участвует в
        расчётах и не сможет вернуть перевод.
      </Text>
      {isOwner ? null : <ReportTask task={task} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  card: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 16 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
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
  statusOpen: { backgroundColor: colors.greenBg, color: colors.greenText },
  statusClosed: { backgroundColor: colors.redStatusBg, color: colors.redStatusText },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 10 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  metaText: { fontSize: 14, color: colors.muted, flexShrink: 1 },
  budgetBox: { backgroundColor: colors.bg, borderRadius: 10, padding: 12, marginVertical: 12 },
  budgetLabel: { fontSize: 13, color: colors.muted },
  budget: { fontSize: 18, fontWeight: '800', color: colors.text, marginTop: 2 },
  noBudget: { fontWeight: '600', color: colors.muted },
  heading: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 6 },
  description: { fontSize: 15, color: colors.text, lineHeight: 22 },
  note: { fontSize: 15, color: colors.muted, marginTop: 6, lineHeight: 21 },
  gap: { marginTop: 12 },
  safety: { fontSize: 13, color: colors.muted, lineHeight: 19, paddingHorizontal: 4 },
  row: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  sent: { fontSize: 14, color: colors.greenText, textAlign: 'center' },
});

import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { myOffers, myTasks } from '../api/tasks';
import { useAuth } from '../auth/AuthContext';
import Loading from '../components/Loading';
import ErrorView from '../components/ErrorView';
import Button from '../components/Button';
import Segmented from '../components/Segmented';
import { OFFER_STATE_LABELS, TASK_STATUS_LABELS, isActiveStatus, som, taskBudget } from '../exchange';
import { offerWord, relativeDate } from '../format';
import { colors } from '../theme';

// «Моё на бирже», как frontend/src/pages/MyTasks.jsx: один человек бывает и
// заказчиком, и исполнителем, поэтому две половины — задачи, которые я разместил,
// и отклики, которые я отправил. Нажатие на строку — экран задачи (onOpen).

// Отклик ещё в игре (ждёт или выбран) — зелёный значок, иначе — красный.
const LIVE_STATES = ['waiting', 'chosen', 'done'];

function Status({ live, children }) {
  return <Text style={[styles.status, live ? styles.statusLive : styles.statusClosed]}>{children}</Text>;
}

function Row({ title, closed, onPress, children }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, closed && styles.closed, pressed && styles.pressed]}
    >
      <Text style={styles.title}>{title}</Text>
      {children}
    </Pressable>
  );
}

function TaskRow({ task, onOpen }) {
  return (
    <Row title={task.title} closed={!isActiveStatus(task.status)} onPress={() => onOpen(task.id)}>
      <View style={styles.badges}>
        <Status live={isActiveStatus(task.status)}>{TASK_STATUS_LABELS[task.status]}</Status>
        {task.new_offers > 0 ? <Text style={styles.new}>+{task.new_offers} новых</Text> : null}
      </View>
      <Text style={styles.meta}>
        {task.city} · {taskBudget(task)} · {task.offers_count} {offerWord(task.offers_count)} ·{' '}
        {relativeDate(task.created_at)}
      </Text>
    </Row>
  );
}

function OfferRow({ offer, onOpen }) {
  const live = LIVE_STATES.includes(offer.state);
  return (
    <Row title={offer.task_title} closed={!live} onPress={() => onOpen(offer.task_id)}>
      <View style={styles.badges}>
        <Status live={live}>{OFFER_STATE_LABELS[offer.state]}</Status>
      </View>
      <Text style={styles.meta}>
        {offer.task_city} · ваша цена {som(offer.price)} · {offer.term}
      </Text>
    </Row>
  );
}

function Empty({ text, action, onPress }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
      <Button title={action} kind="secondary" onPress={onPress} />
    </View>
  );
}

// onBrowse — к ленте всех задач (из пустого списка откликов).
export default function MyExchange({ onOpen, onLogin, onNew, onBrowse }) {
  const { status } = useAuth();
  if (status === 'loading') return <Loading />;
  if (status === 'guest') {
    return (
      <View style={styles.guest}>
        <Text style={styles.emptyText}>Войдите, чтобы видеть свои задачи и отклики на чужие.</Text>
        <Button title="Войти" onPress={onLogin} />
      </View>
    );
  }
  return <MyLists onOpen={onOpen} onNew={onNew} onBrowse={onBrowse} />;
}

function MyLists({ onOpen, onNew, onBrowse }) {
  const { user } = useAuth();
  const [tab, setTab] = useState('tasks');
  const tasks = useQuery({ queryKey: ['my-tasks', user.id], queryFn: myTasks });
  const offers = useQuery({ queryKey: ['my-offers', user.id], queryFn: myOffers });

  const current = tab === 'tasks' ? tasks : offers;
  const newTotal = (tasks.data?.tasks || []).reduce((sum, t) => sum + t.new_offers, 0);

  let empty;
  if (current.isPending) empty = <Loading />;
  else if (current.isError) empty = <ErrorView error={current.error} onRetry={() => current.refetch()} />;
  else if (tab === 'tasks') {
    empty = <Empty text="Вы ещё не размещали задач." action="Разместить задачу" onPress={onNew} />;
  } else empty = <Empty text="Вы ещё не откликались." action="Смотреть задачи" onPress={onBrowse} />;

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={tab === 'tasks' ? tasks.data?.tasks || [] : offers.data?.offers || []}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) =>
        tab === 'tasks' ? <TaskRow task={item} onOpen={onOpen} /> : <OfferRow offer={item} onOpen={onOpen} />
      }
      ListHeaderComponent={
        <Segmented
          items={[
            { value: 'tasks', label: 'Мои задачи', badge: newTotal },
            { value: 'offers', label: 'Мои отклики' },
          ]}
          value={tab}
          onChange={setTab}
          kind="tabs"
          style={styles.switch}
        />
      }
      ListEmptyComponent={empty}
      refreshControl={
        <RefreshControl refreshing={current.isRefetching} onRefresh={() => current.refetch()} colors={[colors.red]} />
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  switch: { marginBottom: 12 },
  guest: { flex: 1, backgroundColor: colors.bg, padding: 20 },
  row: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  closed: { opacity: 0.7 },
  pressed: { opacity: 0.85 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  status: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  statusLive: { backgroundColor: colors.greenBg, color: colors.greenText },
  statusClosed: { backgroundColor: colors.redStatusBg, color: colors.redStatusText },
  new: { fontSize: 12, fontWeight: '700', color: colors.red },
  meta: { fontSize: 13, color: colors.muted, marginTop: 6 },
  empty: { paddingVertical: 32, alignItems: 'center' },
  emptyText: { fontSize: 15, color: colors.muted, textAlign: 'center', marginBottom: 16, lineHeight: 21 },
});

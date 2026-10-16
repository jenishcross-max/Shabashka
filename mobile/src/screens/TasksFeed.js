import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { listTasks } from '../api/tasks';
import { nextPage } from '../api/paging';
import TaskCard from '../components/TaskCard';
import FiltersBar from '../components/FiltersBar';
import Loading from '../components/Loading';
import ErrorView from '../components/ErrorView';
import Button from '../components/Button';
import { colors } from '../theme';

const NO_FILTERS = { q: '', category: '', city: '' };

// Лента открытых задач биржи. Переходы — колбэками (onOpen, onNew): экран не
// знает о роутере и тестируется без него.
export default function TasksFeed({ onOpen, onNew }) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const feed = useInfiniteQuery({
    queryKey: ['tasks', filters],
    queryFn: ({ pageParam }) => listTasks({ ...filters, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: nextPage,
  });

  const tasks = feed.data?.pages.flatMap((p) => p.tasks) ?? [];
  const filtered = filters.q || filters.category || filters.city;

  // Фильтры остаются наверху и во время загрузки, и при ошибке: состояние ленты
  // показывается на месте списка, а не вместо всего экрана.
  let empty;
  if (feed.isPending) empty = <Loading />;
  else if (feed.isError) empty = <ErrorView error={feed.error} onRetry={() => feed.refetch()} />;
  else
    empty = (
      <Text style={styles.empty}>
        {filtered
          ? 'Ничего не нашли — попробуйте изменить поиск или фильтры.'
          : 'Задач пока нет. Разместите свою — исполнители сами предложат цену.'}
      </Text>
    );

  return (
    <FlatList
      testID="tasks-list"
      style={styles.list}
      data={tasks}
      keyExtractor={(t) => String(t.id)}
      renderItem={({ item }) => <TaskCard task={item} onPress={() => onOpen(item.id)} />}
      ListHeaderComponent={
        <View>
          <FiltersBar filters={filters} onChange={setFilters} />
          <Button title="+ Разместить задачу" onPress={onNew} style={styles.newTask} />
        </View>
      }
      ListEmptyComponent={empty}
      ListFooterComponent={
        feed.isFetchingNextPage ? <ActivityIndicator color={colors.red} style={styles.more} /> : null
      }
      onEndReached={() => feed.hasNextPage && !feed.isFetchingNextPage && feed.fetchNextPage()}
      onEndReachedThreshold={0.5}
      refreshControl={
        <RefreshControl
          refreshing={feed.isRefetching && !feed.isFetchingNextPage}
          onRefresh={() => feed.refetch()}
          colors={[colors.red]}
        />
      }
      keyboardShouldPersistTaps="handled"
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.bg },
  newTask: { marginHorizontal: 16, marginTop: 8, marginBottom: 14 },
  empty: { color: colors.muted, fontSize: 15, textAlign: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  more: { paddingVertical: 16 },
});

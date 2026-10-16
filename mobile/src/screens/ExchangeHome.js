import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Segmented from '../components/Segmented';
import TasksFeed from './TasksFeed';
import MyExchange from './MyExchange';
import { colors } from '../theme';

// Вкладка «Биржа»: лента всех задач и «Моё» под одним переключателем. Лента не
// размонтируется — после «Моё» человек возвращается к тому же поиску и месту в
// списке. «Моё» грузится, только когда его впервые открыли.
export default function ExchangeHome({ onOpen, onNew, onLogin }) {
  const [mode, setMode] = useState('all');
  const [mineOpened, setMineOpened] = useState(false);

  const change = (value) => {
    setMode(value);
    if (value === 'mine') setMineOpened(true);
  };

  return (
    <View style={styles.screen}>
      <Segmented
        items={[
          { value: 'all', label: 'Все задачи' },
          { value: 'mine', label: 'Моё' },
        ]}
        value={mode}
        onChange={change}
        style={styles.switch}
      />
      <View style={[styles.flex, mode !== 'all' && styles.hidden]}>
        <TasksFeed onOpen={onOpen} onNew={onNew} />
      </View>
      {mineOpened ? (
        <View style={[styles.flex, mode !== 'mine' && styles.hidden]}>
          <MyExchange onOpen={onOpen} onNew={onNew} onLogin={onLogin} onBrowse={() => setMode('all')} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  switch: { marginHorizontal: 16, marginTop: 12 },
  flex: { flex: 1 },
  hidden: { display: 'none' },
});

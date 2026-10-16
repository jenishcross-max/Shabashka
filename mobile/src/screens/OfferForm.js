import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { saveOffer } from '../api/tasks';
import { useTask } from '../hooks/useTask';
import { refreshTask } from '../hooks/useTaskAction';
import Loading from '../components/Loading';
import ErrorView from '../components/ErrorView';
import Field from '../components/Field';
import Button from '../components/Button';
import FormScreen, { FormError } from '../components/FormScreen';
import { colors } from '../theme';

// Форма отклика: цена, срок, что сделаете. Одна на новый отклик и на правку —
// свой прежний отклик (и отозванный тоже) подставляется. Проверяет сервер,
// форма показывает его текст. onDone — назад к задаче.
export default function OfferForm({ id, onDone }) {
  const query = useTask(id);
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorView error={query.error} onRetry={() => query.refetch()} />;
  return <OfferFields id={id} task={query.data.task} myOffer={query.data.my_offer} onDone={onDone} />;
}

function OfferFields({ id, task, myOffer, onDone }) {
  const queryClient = useQueryClient();
  const editing = myOffer?.state === 'waiting';
  const [form, setForm] = useState({
    price: myOffer ? String(myOffer.price) : '',
    term: myOffer?.term || '',
    comment: myOffer?.comment || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit() {
    setError('');
    setBusy(true);
    try {
      await saveOffer(id, form);
      await refreshTask(queryClient, id);
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <FormScreen title={editing ? 'Изменить отклик' : 'Предложить свою цену'} subtitle={task.title}>
      <Field
        label="Ваша цена, сом"
        value={form.price}
        onChangeText={set('price')}
        keyboardType="number-pad"
        placeholder="2500"
      />
      <Field
        label="Срок"
        value={form.term}
        onChangeText={set('term')}
        maxLength={60}
        placeholder="Например: завтра до обеда"
      />
      <Field
        label="Что сделаете"
        value={form.comment}
        onChangeText={set('comment')}
        multiline
        maxLength={1000}
        placeholder="Как будете делать, что возьмёте с собой, есть ли опыт"
      />
      <FormError>{error}</FormError>
      <Button title={editing ? 'Сохранить отклик' : 'Отправить отклик'} busy={busy} onPress={submit} />
      <Text style={styles.hint}>
        Отклик увидит только заказчик. Пока он не выбрал исполнителя, отклик можно изменить или отозвать.
      </Text>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, color: colors.muted, marginTop: 14, lineHeight: 19 },
});

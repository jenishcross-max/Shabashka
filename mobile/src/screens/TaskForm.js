import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createTask, updateTask } from '../api/tasks';
import { listCategories } from '../api/catalog';
import { resendVerification } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { useTask } from '../hooks/useTask';
import { refreshTask } from '../hooks/useTaskAction';
import Loading from '../components/Loading';
import ErrorView from '../components/ErrorView';
import Field from '../components/Field';
import Button from '../components/Button';
import Picker from '../components/Picker';
import FormScreen, { FormError } from '../components/FormScreen';
import { colors } from '../theme';

// Одна форма на «разместить» и «изменить», как frontend/src/pages/NewTask.jsx:
// поля те же, разница — откуда начальные значения и куда уходит запрос. Телефона
// здесь нет намеренно: он уже в аккаунте и откроется только выбранному исполнителю.
// Проверяет поля сервер, форма показывает его текст. onDone(id задачи) — дальше.

const FORMATS = [
  ['offline', 'Офлайн'],
  ['online', 'Онлайн'],
];

const EMPTY = {
  title: '',
  description: '',
  category: '',
  city: '',
  address: '',
  work_format: 'offline',
  budget: '',
  when_text: '',
};

const toForm = (task) => ({
  title: task.title,
  description: task.description,
  category: task.category,
  city: task.city,
  address: task.address || '',
  work_format: task.work_format,
  budget: task.budget ? String(task.budget) : '',
  when_text: task.when_text || '',
});

export default function TaskForm({ id, onDone, onLogin }) {
  const { status, user } = useAuth();
  if (status === 'loading') return <Loading />;
  if (status === 'guest') {
    return (
      <FormScreen
        title="Разместить задачу"
        subtitle="Войдите, чтобы разместить задачу: исполнители предложат цену и срок."
      >
        <Button title="Войти" onPress={onLogin} />
      </FormScreen>
    );
  }
  if (id) return <EditTask id={id} onDone={onDone} />;
  return <TaskFields initial={{ ...EMPTY, city: user.city || '' }} onDone={onDone} />;
}

function EditTask({ id, onDone }) {
  const { user } = useAuth();
  const query = useTask(id);
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorView error={query.error} onRetry={() => query.refetch()} />;
  const { task } = query.data;
  // Те же отказы, что дал бы сервер, — но до того, как человек всё перепишет.
  if (task.user_id !== user.id) return <ErrorView error={{ message: 'Это не ваша задача' }} />;
  if (task.status !== 'open') {
    return <ErrorView error={{ message: 'Задачу можно править, пока исполнитель не выбран' }} />;
  }
  return <TaskFields id={id} initial={toForm(task)} onDone={onDone} />;
}

function TaskFields({ id, initial, onDone }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const categories = useQuery({
    queryKey: ['categories', form.work_format],
    queryFn: () => listCategories(form.work_format),
    staleTime: Infinity,
  });
  const list = categories.data?.categories;
  // У онлайна и офлайна свои категории: выбранная для другого формата не годится.
  // Пока список грузится, оставляем как есть — при правке там категория задачи.
  const category = !list || list.includes(form.category) ? form.category : '';

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const fields = { ...form, category, budget: form.budget.trim() };
      const { task } = id ? await updateTask(id, fields) : await createTask(fields);
      if (id) await refreshTask(queryClient, id);
      else for (const queryKey of [['tasks'], ['my-tasks']]) queryClient.invalidateQueries({ queryKey });
      onDone(task.id);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <FormScreen
      title={id ? 'Изменить задачу' : 'Разместить задачу'}
      subtitle="Опишите, что нужно сделать. Исполнители предложат цену и срок — вы сравните и выберете одного."
    >
      <Field
        label="Что нужно сделать"
        value={form.title}
        onChangeText={set('title')}
        maxLength={100}
        placeholder="Например: убраться в двухкомнатной квартире"
      />
      <Field
        label="Подробности"
        value={form.description}
        onChangeText={set('description')}
        multiline
        maxLength={3000}
        placeholder="Объём работы, что есть на месте, особые пожелания"
      />

      <Text style={styles.label}>Формат работы</Text>
      <View style={styles.formats}>
        {FORMATS.map(([value, label]) => {
          const active = form.work_format === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              onPress={() => set('work_format')(value)}
              style={[styles.format, active && styles.formatActive]}
            >
              <Text style={[styles.formatText, active && styles.formatTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Категория</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Категория: ${category || 'не выбрана'}`}
        onPress={() => setPicking(true)}
        style={styles.select}
      >
        <Text style={category ? styles.selectText : styles.placeholder}>{category || 'Выберите из списка'}</Text>
      </Pressable>
      <Picker
        visible={picking}
        title="Категория"
        options={(list || []).map((c) => ({ value: c, label: c }))}
        value={category}
        onPick={(value) => {
          setPicking(false);
          set('category')(value);
        }}
        onClose={() => setPicking(false)}
      />

      <Field label="Город" value={form.city} onChangeText={set('city')} maxLength={60} placeholder="Бишкек" />
      <Field
        label="Район или ориентир (необязательно)"
        value={form.address}
        onChangeText={set('address')}
        maxLength={200}
        placeholder="Например: мкр. Джал-1, рядом с рынком"
      />
      <Field
        label="Бюджет, сом (необязательно)"
        value={form.budget}
        onChangeText={set('budget')}
        keyboardType="number-pad"
        placeholder="3000"
      />
      <Field
        label="Когда нужно (необязательно)"
        value={form.when_text}
        onChangeText={set('when_text')}
        maxLength={60}
        placeholder="Например: в субботу утром"
      />
      <Text style={styles.hint}>
        Без бюджета исполнители предложат свою цену. Ваш телефон увидит только исполнитель, которого вы выберете.
      </Text>

      <FormError>{error?.message}</FormError>
      {error?.code === 'EMAIL_NOT_VERIFIED' ? <ResendLetter /> : null}
      <Button title={id ? 'Сохранить' : 'Опубликовать задачу'} busy={busy} onPress={submit} />
    </FormScreen>
  );
}

// Вторая задача — только с подтверждённой почтой: письмо могло потеряться.
function ResendLetter() {
  const [state, setState] = useState({ busy: false, note: '' });
  async function send() {
    setState({ busy: true, note: '' });
    try {
      await resendVerification();
      setState({ busy: false, note: 'Письмо отправлено — откройте ссылку из него и опубликуйте задачу снова.' });
    } catch (e) {
      setState({ busy: false, note: e.message });
    }
  }
  return (
    <View style={styles.resend}>
      {state.note ? <Text style={styles.note}>{state.note}</Text> : null}
      <Button title="Отправить письмо ещё раз" kind="secondary" busy={state.busy} onPress={send} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 6 },
  formats: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  format: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.card,
    paddingVertical: 10,
  },
  formatActive: { borderColor: colors.red, backgroundColor: colors.redTint },
  formatText: { fontSize: 15, color: colors.text },
  formatTextActive: { color: colors.redDark, fontWeight: '700' },
  select: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 14,
  },
  selectText: { fontSize: 16, color: colors.text },
  placeholder: { fontSize: 16, color: colors.mutedLight },
  hint: { fontSize: 13, color: colors.muted, marginBottom: 14, lineHeight: 19 },
  resend: { marginBottom: 14 },
  note: { fontSize: 14, color: colors.text, marginBottom: 8, lineHeight: 20 },
});

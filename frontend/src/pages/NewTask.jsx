import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useCities } from '../useCities';
import Logo from '../components/Logo';
import FormatIcon from '../components/FormatIcon';
import CityAutocomplete from '../components/CityAutocomplete';
import { SkeletonForm } from '../components/Skeleton';

// Одна форма на «разместить» и «изменить»: поля те же, разница только в том,
// откуда берутся начальные значения и куда уходит запрос. Телефона здесь нет
// намеренно — он уже есть в аккаунте и откроется только выбранному исполнителю.
export default function NewTask() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { token, user } = useAuth();
  const cities = useCities();
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    city: user?.city || '',
    address: '',
    work_format: 'offline',
    budget: '',
    when_text: '',
  });
  const [loaded, setLoaded] = useState(!editing);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    if (!editing) return;
    api
      .task(id, token)
      .then(({ task }) => {
        if (task.user_id !== user?.id) throw new Error('Это не ваша задача');
        if (task.status !== 'open') throw new Error('Задачу можно править, пока исполнитель не выбран');
        setForm({
          title: task.title,
          description: task.description,
          category: task.category,
          city: task.city,
          address: task.address || '',
          work_format: task.work_format,
          budget: task.budget ? String(task.budget) : '',
          when_text: task.when_text || '',
        });
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, [editing, id, token, user?.id]);

  // При правке — только после загрузки задачи: иначе список для формата по
  // умолчанию мог прийти позже и подменить её категорию первой из списка.
  // Формат переключают быстро — ответ для прежнего формата не должен прийти
  // последним и оставить в списке чужие категории.
  useEffect(() => {
    if (!loaded) return undefined;
    let current = true;
    api
      .categories(form.work_format)
      .then(({ categories }) => {
        if (!current) return;
        setCategories(categories);
        setForm((f) => (categories.includes(f.category) ? f : { ...f, category: categories[0] || '' }));
      })
      .catch((e) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [form.work_format, loaded]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = { ...form, budget: form.budget.trim() };
      const { task } = editing
        ? await api.updateTask(id, payload, token)
        : await api.createTask(payload, token);
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded) {
    return error ? (
      <p className="status-msg error">
        {error}. <Link to={`/tasks/${id}`}>Вернуться к задаче</Link>
      </p>
    ) : (
      <SkeletonForm fields={6} />
    );
  }

  return (
    <div className="form-card wide">
      <div className="card-header">
        <Logo size="sm" />
        <span className="who">{user?.name} · Биржа услуг</span>
      </div>
      <div className="card-body">
        <h1>{editing ? 'Изменить задачу' : 'Разместить задачу'}</h1>
        <p className="subtitle">
          Опишите, что нужно сделать. Исполнители предложат цену и срок — вы сравните и выберете
          одного.
        </p>
        {/* Довод разместить задачу здесь, а не в чате: охват. Раздаёт админ
            после проверки (см. backend/src/telegram/taskShare.js). */}
        {!editing && (
          <ul className="task-reach">
            <li>📣 После проверки покажем задачу в Threads и Telegram-канале Шабашки — там тысячи подписчиков.</li>
            <li>⚡ Исполнители, подписанные на биржу, получат её в Telegram сразу.</li>
            <li>💸 Бесплатно и без комиссии: о цене договариваетесь напрямую.</li>
          </ul>
        )}

        <form onSubmit={handleSubmit}>
          <label className="field">
            <span className="label">Что нужно сделать</span>
            <input
              required
              maxLength={100}
              placeholder="Например: убраться в двухкомнатной квартире"
              value={form.title}
              onChange={set('title')}
            />
          </label>
          <label className="field">
            <span className="label">Подробности</span>
            <textarea
              required
              rows={5}
              maxLength={3000}
              placeholder="Объём работы, что есть на месте, особые пожелания"
              value={form.description}
              onChange={set('description')}
            />
          </label>
          <div className="field">
            <span className="label">Формат работы</span>
            <div className="format-toggle">
              {[
                ['offline', 'Офлайн'],
                ['online', 'Онлайн'],
              ].map(([value, label]) => (
                <label key={value} className={`format-option${form.work_format === value ? ' active' : ''}`}>
                  <input
                    type="radio"
                    name="work_format"
                    value={value}
                    checked={form.work_format === value}
                    onChange={set('work_format')}
                  />
                  <FormatIcon name={value} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="label">Категория</span>
              <select value={form.category} onChange={set('category')}>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Город</span>
              <CityAutocomplete
                required
                cities={cities}
                value={form.city}
                onChange={(v) => setForm((f) => ({ ...f, city: v }))}
              />
            </label>
          </div>
          <label className="field">
            <span className="label">Район или ориентир (необязательно)</span>
            <input
              maxLength={200}
              placeholder="Например: мкр. Джал-1, рядом с рынком"
              value={form.address}
              onChange={set('address')}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span className="label">Бюджет, сом (необязательно)</span>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="3000"
                value={form.budget}
                onChange={set('budget')}
              />
            </label>
            <label className="field">
              <span className="label">Когда нужно (необязательно)</span>
              <input
                maxLength={60}
                placeholder="Например: в субботу утром"
                value={form.when_text}
                onChange={set('when_text')}
              />
            </label>
          </div>
          <p className="format-hint">
            Без бюджета исполнители предложат свою цену. Ваш телефон увидит только исполнитель,
            которого вы выберете.
          </p>
          {error && <p className="status-msg error">{error}</p>}
          <button className="submit-btn" type="submit" disabled={submitting}>
            {submitting
              ? editing
                ? 'Сохраняем…'
                : 'Публикуем…'
              : editing
              ? 'Сохранить'
              : 'Опубликовать задачу'}
          </button>
        </form>
      </div>
    </div>
  );
}

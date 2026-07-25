import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useCities } from '../useCities';
import Logo from '../components/Logo';

export default function EditOrder() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const cities = useCities();
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api
      .order(id)
      .then(({ order }) => {
        if (order.user_id !== user?.id) {
          setNotFound(true);
          return;
        }
        setForm({
          title: order.title,
          description: order.description,
          category: order.category,
          city: order.city,
          address: order.address || '',
          work_format: order.work_format || 'offline',
          budget: order.budget ?? '',
          whatsapp_phone: order.whatsapp_phone,
        });
      })
      .catch(() => setNotFound(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!form) return;
    api.categories(form.work_format).then(({ categories }) => {
      setCategories(categories);
      setForm((f) => (categories.includes(f.category) ? f : { ...f, category: categories[0] || '' }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.work_format]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.updateOrder(id, { ...form, budget: form.budget ? Number(form.budget) : null }, token);
      navigate(`/orders/${id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (notFound) return <p className="status-msg error">Заказ не найден или это не ваш заказ.</p>;
  if (!form) return <p className="status-msg">Загрузка…</p>;

  return (
    <div className="form-card wide">
      <div className="card-header">
        <Logo size="sm" />
        <span className="who">{user?.name} · Мои заказы</span>
      </div>
      <div className="card-body">
        <h1>Редактировать заказ</h1>
        <p className="subtitle">
          <Link to={`/orders/${id}`}>← Вернуться к заказу</Link>
        </p>
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span className="label">Заголовок</span>
            <input
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="label">Описание</span>
            <textarea
              required
              rows={4}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </label>
          <div className="field">
            <span className="label">Формат работы</span>
            <div className="format-toggle">
              <label className={`format-option${form.work_format === 'offline' ? ' active' : ''}`}>
                <input
                  type="radio"
                  name="work_format"
                  value="offline"
                  checked={form.work_format === 'offline'}
                  onChange={(e) => setForm((f) => ({ ...f, work_format: e.target.value }))}
                />
                📍 Офлайн
              </label>
              <label className={`format-option${form.work_format === 'online' ? ' active' : ''}`}>
                <input
                  type="radio"
                  name="work_format"
                  value="online"
                  checked={form.work_format === 'online'}
                  onChange={(e) => setForm((f) => ({ ...f, work_format: e.target.value }))}
                />
                🌐 Онлайн
              </label>
            </div>
            <p className="format-hint">
              <strong>Офлайн</strong> — обычная работа, где нужно физически присутствовать (в
              мастерской, на объекте, у клиента). <strong>Онлайн</strong> — удалённая работа через
              интернет, без необходимости куда-то ехать — например, консультации по видеосвязи или
              работа за компьютером из дома.
            </p>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="label">Категория</span>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="label">Город</span>
              <input
                required
                list="cities-list"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </label>
          </div>
          <label className="field">
            <span className="label">Примерный адрес или район (необязательно)</span>
            <input
              placeholder="Например: мкр. Джал-1, рядом с рынком"
              maxLength={200}
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span className="label">Бюджет, сом (необязательно)</span>
              <input
                type="number"
                min="0"
                value={form.budget}
                onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))}
              />
            </label>
            <label className="field">
              <span className="label">WhatsApp для связи</span>
              <input
                type="tel"
                required
                value={form.whatsapp_phone}
                onChange={(e) => setForm((f) => ({ ...f, whatsapp_phone: e.target.value }))}
              />
            </label>
          </div>
          {error && <p className="status-msg error">{error}</p>}
          <button className="submit-btn" type="submit" disabled={submitting}>
            {submitting ? 'Сохраняем…' : 'Сохранить изменения'}
          </button>
        </form>
      </div>
      <datalist id="cities-list">
        {cities.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

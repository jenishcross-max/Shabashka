import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useCities } from '../useCities';
import Logo from '../components/Logo';

export default function NewOrder() {
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
    whatsapp_phone: user?.phone || '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.categories().then(({ categories }) => {
      setCategories(categories);
      setForm((f) => ({ ...f, category: f.category || categories[0] }));
    });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { order } = await api.createOrder(
        { ...form, budget: form.budget ? Number(form.budget) : null },
        token
      );
      navigate(`/orders/${order.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="form-card wide">
      <div className="card-header">
        <Logo size="sm" />
        <span className="who">{user?.name} · Мои заказы</span>
      </div>
      <div className="card-body">
        <h1>Разместить заказ</h1>
        <p className="subtitle">Опишите задачу — исполнители напишут вам в WhatsApp.</p>

        <div className="order-tips">
          <h3>Как оформить заказ, чтобы мастер откликнулся быстрее</h3>
          <ul>
            <li>Опишите, что именно нужно сделать, и укажите объём работы.</li>
            <li>Если знаете бюджет — укажите его, это ускоряет отклик.</li>
            <li>
              Напишите <strong>примерный район или ориентир</strong> (например, «мкр. Джал-1» или
              «рядом с рынком»), чтобы мастер понимал расстояние.
            </li>
            <li>
              Точный адрес, номер дома и подъезд называйте только в переписке в WhatsApp, когда
              договоритесь с исполнителем — не указывайте их в самом объявлении.
            </li>
          </ul>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="field">
            <span className="label">Заголовок</span>
            <input
              required
              placeholder="Например: почистить дымоход"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="label">Описание</span>
            <textarea
              required
              rows={4}
              placeholder="Опишите, что нужно сделать"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </label>
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
              <strong>Офлайн</strong> — нужно приехать или встретиться лично (ремонт, уборка,
              доставка и т.п.). <strong>Онлайн</strong> — можно сделать удалённо, без личной
              встречи, например по видеосвязи или через интернет (репетитор по видео, консультация,
              дизайн).
            </p>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="label">Бюджет, сом (необязательно)</span>
              <input
                type="number"
                min="0"
                placeholder="2000"
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
            {submitting ? 'Публикуем…' : 'Опубликовать заказ'}
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

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useCities } from '../useCities';

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
    budget: '',
    whatsapp_phone: user?.phone || '',
  });
  const [photo, setPhoto] = useState(null);
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
      if (photo) {
        await api.uploadOrderPhoto(order.id, photo, token);
      }
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
        <span className="brand">
          <span className="brand-mark">Ш</span>
          Шабашка<span>.kg</span>
        </span>
        <span className="who">{user?.name} · Мои заказы</span>
      </div>
      <div className="card-body">
        <h1>Разместить заказ</h1>
        <p className="subtitle">Опишите задачу — исполнители напишут вам в WhatsApp.</p>
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
          <label className="field">
            <span className="label">Фото (необязательно)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setPhoto(e.target.files?.[0] || null)}
            />
          </label>
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

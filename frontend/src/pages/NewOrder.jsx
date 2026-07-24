import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export default function NewOrder() {
  const { token, user } = useAuth();
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
    <div className="auth-form">
      <h1>Разместить заказ</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Заголовок
          <input
            required
            placeholder="Например: почистить дымоход"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </label>
        <label>
          Описание
          <textarea
            required
            rows={5}
            placeholder="Опишите, что нужно сделать"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </label>
        <label>
          Категория
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
        <label>
          Город
          <input
            required
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
          />
        </label>
        <label>
          Бюджет, сом (необязательно)
          <input
            type="number"
            min="0"
            value={form.budget}
            onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))}
          />
        </label>
        <label>
          Номер WhatsApp для связи
          <input
            type="tel"
            required
            value={form.whatsapp_phone}
            onChange={(e) => setForm((f) => ({ ...f, whatsapp_phone: e.target.value }))}
          />
        </label>
        {error && <p className="status-msg error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Публикуем…' : 'Опубликовать заказ'}
        </button>
      </form>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useCities } from '../useCities';
import Logo from '../components/Logo';

export default function NewVacancy() {
  const { token, user } = useAuth();
  const cities = useCities();
  const navigate = useNavigate();
  const [categories, setCategories] = useState([]);
  const [employmentTypes, setEmploymentTypes] = useState([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    employment_type: '',
    city: user?.city || '',
    address: '',
    salary_min: '',
    salary_max: '',
    schedule: '',
    whatsapp_phone: user?.phone || '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.categories().then(({ categories }) => {
      setCategories(categories);
      setForm((f) => ({ ...f, category: f.category || categories[0] }));
    });
    api.employmentTypes().then(({ employmentTypes }) => {
      setEmploymentTypes(employmentTypes);
      setForm((f) => ({ ...f, employment_type: f.employment_type || employmentTypes[0]?.value }));
    });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { vacancy } = await api.createVacancy(
        {
          ...form,
          salary_min: form.salary_min ? Number(form.salary_min) : null,
          salary_max: form.salary_max ? Number(form.salary_max) : null,
        },
        token
      );
      navigate(`/vacancies/${vacancy.id}`);
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
        <span className="who">{user?.name} · Мои вакансии</span>
      </div>
      <div className="card-body">
        <h1>Разместить вакансию</h1>
        <p className="subtitle">Опишите вакансию — соискатели напишут вам в WhatsApp.</p>

        <div className="order-tips">
          <h3>Как оформить вакансию, чтобы отклики были быстрее</h3>
          <ul>
            <li>Опишите обязанности, требования и условия работы.</li>
            <li>Укажите вилку зарплаты — вакансии с зарплатой откликаются охотнее.</li>
            <li>
              Напишите <strong>примерный район или ориентир</strong>, где находится работа, — точный
              адрес называйте только в переписке в WhatsApp.
            </li>
          </ul>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="field">
            <span className="label">Название вакансии</span>
            <input
              required
              placeholder="Например: мастер маникюра в салон"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="label">Описание</span>
            <textarea
              required
              rows={4}
              placeholder="Обязанности, требования, условия работы"
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
              <span className="label">Занятость</span>
              <select
                value={form.employment_type}
                onChange={(e) => setForm((f) => ({ ...f, employment_type: e.target.value }))}
              >
                {employmentTypes.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span className="label">Город</span>
              <input
                required
                list="cities-list"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </label>
            <label className="field">
              <span className="label">График (необязательно)</span>
              <input
                placeholder="Например: Пн–Пт, 9:00–18:00"
                maxLength={120}
                value={form.schedule}
                onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
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
              <span className="label">Зарплата от, сом (необязательно)</span>
              <input
                type="number"
                min="0"
                placeholder="20000"
                value={form.salary_min}
                onChange={(e) => setForm((f) => ({ ...f, salary_min: e.target.value }))}
              />
            </label>
            <label className="field">
              <span className="label">Зарплата до, сом (необязательно)</span>
              <input
                type="number"
                min="0"
                placeholder="35000"
                value={form.salary_max}
                onChange={(e) => setForm((f) => ({ ...f, salary_max: e.target.value }))}
              />
            </label>
          </div>
          <label className="field">
            <span className="label">WhatsApp для связи</span>
            <input
              type="tel"
              required
              value={form.whatsapp_phone}
              onChange={(e) => setForm((f) => ({ ...f, whatsapp_phone: e.target.value }))}
            />
          </label>
          {error && <p className="status-msg error">{error}</p>}
          <button className="submit-btn" type="submit" disabled={submitting}>
            {submitting ? 'Публикуем…' : 'Опубликовать вакансию'}
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

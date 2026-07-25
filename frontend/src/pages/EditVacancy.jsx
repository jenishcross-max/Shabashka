import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useCities } from '../useCities';

export default function EditVacancy() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const cities = useCities();
  const [categories, setCategories] = useState([]);
  const [employmentTypes, setEmploymentTypes] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api.categories().then(({ categories }) => setCategories(categories));
    api.employmentTypes().then(({ employmentTypes }) => setEmploymentTypes(employmentTypes));
    api
      .vacancy(id)
      .then(({ vacancy }) => {
        if (vacancy.user_id !== user?.id) {
          setNotFound(true);
          return;
        }
        setForm({
          title: vacancy.title,
          description: vacancy.description,
          category: vacancy.category,
          employment_type: vacancy.employment_type,
          city: vacancy.city,
          address: vacancy.address || '',
          schedule: vacancy.schedule || '',
          salary_min: vacancy.salary_min ?? '',
          salary_max: vacancy.salary_max ?? '',
          whatsapp_phone: vacancy.whatsapp_phone,
        });
      })
      .catch(() => setNotFound(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.updateVacancy(
        id,
        {
          ...form,
          salary_min: form.salary_min ? Number(form.salary_min) : null,
          salary_max: form.salary_max ? Number(form.salary_max) : null,
        },
        token
      );
      navigate(`/vacancies/${id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (notFound) return <p className="status-msg error">Вакансия не найдена или это не ваша вакансия.</p>;
  if (!form) return <p className="status-msg">Загрузка…</p>;

  return (
    <div className="form-card wide">
      <div className="card-header">
        <span className="brand">
          <span className="brand-mark">Ш</span>
          Шабашка
        </span>
        <span className="who">{user?.name} · Мои вакансии</span>
      </div>
      <div className="card-body">
        <h1>Редактировать вакансию</h1>
        <p className="subtitle">
          <Link to={`/vacancies/${id}`}>← Вернуться к вакансии</Link>
        </p>
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span className="label">Название вакансии</span>
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
                maxLength={120}
                value={form.schedule}
                onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
              />
            </label>
          </div>
          <label className="field">
            <span className="label">Примерный адрес или район (необязательно)</span>
            <input
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
                value={form.salary_min}
                onChange={(e) => setForm((f) => ({ ...f, salary_min: e.target.value }))}
              />
            </label>
            <label className="field">
              <span className="label">Зарплата до, сом (необязательно)</span>
              <input
                type="number"
                min="0"
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

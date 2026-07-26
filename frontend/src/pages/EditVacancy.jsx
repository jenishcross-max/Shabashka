import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useCities } from '../useCities';
import Logo from '../components/Logo';

export default function EditVacancy() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const cities = useCities();
  const [categories, setCategories] = useState([]);
  const [employmentTypes, setEmploymentTypes] = useState([]);
  const [experienceLevels, setExperienceLevels] = useState([]);
  const [form, setForm] = useState(null);
  const [showPhone, setShowPhone] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api.employmentTypes().then(({ employmentTypes }) => setEmploymentTypes(employmentTypes));
    api.experienceLevels().then(({ experienceLevels }) => setExperienceLevels(experienceLevels));
    api
      .vacancy(id)
      .then(({ vacancy }) => {
        if (vacancy.user_id !== user?.id) {
          setNotFound(true);
          return;
        }
        setShowPhone(!!vacancy.whatsapp_phone);
        setForm({
          title: vacancy.title,
          description: vacancy.description,
          category: vacancy.category,
          employment_type: vacancy.employment_type,
          experience: vacancy.experience || 'no_experience',
          requirements: vacancy.requirements || '',
          conditions: vacancy.conditions || '',
          city: vacancy.city,
          address: vacancy.address || '',
          work_format: vacancy.work_format || 'offline',
          schedule: vacancy.schedule || '',
          salary_min: vacancy.salary_min ?? '',
          salary_max: vacancy.salary_max ?? '',
          whatsapp_phone: vacancy.whatsapp_phone || '',
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
      await api.updateVacancy(
        id,
        {
          ...form,
          salary_min: form.salary_min ? Number(form.salary_min) : null,
          salary_max: form.salary_max ? Number(form.salary_max) : null,
          whatsapp_phone: showPhone ? form.whatsapp_phone : '',
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
        <Logo size="sm" />
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
              <span className="label">Требуемый опыт работы</span>
              <select
                value={form.experience}
                onChange={(e) => setForm((f) => ({ ...f, experience: e.target.value }))}
              >
                {experienceLevels.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
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
              maxLength={200}
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="label">Обязанности</span>
            <textarea
              required
              rows={4}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="label">Требования к кандидату (необязательно)</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={form.requirements}
              onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="label">Условия работы (необязательно)</span>
            <textarea
              rows={3}
              maxLength={2000}
              value={form.conditions}
              onChange={(e) => setForm((f) => ({ ...f, conditions: e.target.value }))}
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
            <span className="label">График (необязательно)</span>
            <input
              maxLength={120}
              value={form.schedule}
              onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
            />
          </label>
          <div className="field">
            <label className="filter-checkbox">
              <input type="checkbox" checked={showPhone} onChange={(e) => setShowPhone(e.target.checked)} />
              Указать номер WhatsApp для связи
            </label>
            {showPhone ? (
              <input
                type="tel"
                required
                placeholder="+996 700 123 456"
                value={form.whatsapp_phone}
                onChange={(e) => setForm((f) => ({ ...f, whatsapp_phone: e.target.value }))}
              />
            ) : (
              <p className="format-hint">
                Без номера с вами можно будет связаться только через переписку на сайте — для этого
                соискателю нужно войти в аккаунт.
              </p>
            )}
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

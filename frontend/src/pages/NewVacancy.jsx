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
  const [experienceLevels, setExperienceLevels] = useState([]);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    employment_type: '',
    experience: '',
    requirements: '',
    conditions: '',
    city: user?.city || '',
    address: '',
    work_format: 'offline',
    salary_min: '',
    salary_max: '',
    schedule: '',
    whatsapp_phone: user?.phone || '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.employmentTypes().then(({ employmentTypes }) => {
      setEmploymentTypes(employmentTypes);
      setForm((f) => ({ ...f, employment_type: f.employment_type || employmentTypes[0]?.value }));
    });
    api.experienceLevels().then(({ experienceLevels }) => {
      setExperienceLevels(experienceLevels);
      setForm((f) => ({ ...f, experience: f.experience || experienceLevels[0]?.value }));
    });
  }, []);

  useEffect(() => {
    api.categories(form.work_format).then(({ categories }) => {
      setCategories(categories);
      setForm((f) => (categories.includes(f.category) ? f : { ...f, category: categories[0] || '' }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.work_format]);

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
            <li>Отдельно опишите обязанности, требования к кандидату и условия работы.</li>
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
              placeholder="Например: мкр. Джал-1, рядом с рынком"
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
              placeholder="Чем предстоит заниматься"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="label">Требования к кандидату (необязательно)</span>
            <textarea
              rows={3}
              placeholder="Опыт, навыки, что важно для этой позиции"
              maxLength={2000}
              value={form.requirements}
              onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="label">Условия работы (необязательно)</span>
            <textarea
              rows={3}
              placeholder="График, оформление, соцпакет и другие условия"
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
            <span className="label">График (необязательно)</span>
            <input
              placeholder="Например: Пн–Пт, 9:00–18:00"
              maxLength={120}
              value={form.schedule}
              onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
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

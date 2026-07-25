import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { relativeDate } from '../formatDate';
import { formatSalary } from '../components/VacancyCard';
import MyListingsTabs from '../components/MyListingsTabs';

export default function MyVacancies() {
  const { token } = useAuth();
  const [vacancies, setVacancies] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .myVacancies(token)
      .then(({ vacancies }) => setVacancies(vacancies))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  async function toggleStatus(vacancy) {
    const nextStatus = vacancy.status === 'open' ? 'closed' : 'open';
    await api.setVacancyStatus(vacancy.id, nextStatus, token);
    load();
  }

  async function remove(vacancy) {
    if (!confirm('Удалить эту вакансию?')) return;
    await api.deleteVacancy(vacancy.id, token);
    load();
  }

  if (loading) return <p className="status-msg">Загрузка…</p>;
  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div>
      <MyListingsTabs active="vacancies" />
      <div className="my-orders-head">
        <h1>Мои вакансии</h1>
        <Link to="/vacancies/new" className="cta">
          + Новая вакансия
        </Link>
      </div>
      {vacancies.length === 0 && (
        <p className="status-msg">
          У вас пока нет вакансий. <Link to="/vacancies/new">Разместить первую вакансию</Link>
        </p>
      )}
      <div className="my-orders-list">
        {vacancies.map((vacancy) => (
          <div key={vacancy.id} className={`my-order-row${vacancy.status === 'closed' ? ' closed' : ''}`}>
            <div>
              <div className="my-order-title-row">
                <Link to={`/vacancies/${vacancy.id}`}>{vacancy.title}</Link>
                <span className={`badge status-${vacancy.status}`}>
                  {vacancy.status === 'open' ? 'Открыта' : 'Закрыта'}
                </span>
              </div>
              <div className="my-order-meta">
                {vacancy.category} · {vacancy.city} · {formatSalary(vacancy.salary_min, vacancy.salary_max)} ·{' '}
                {relativeDate(vacancy.created_at)} · 👁 {vacancy.views}
              </div>
            </div>
            <div className="my-order-actions">
              <Link to={`/vacancies/${vacancy.id}/edit`}>Изменить</Link>
              <button onClick={() => toggleStatus(vacancy)}>
                {vacancy.status === 'open' ? 'Закрыть' : 'Открыть снова'}
              </button>
              <button className="danger" onClick={() => remove(vacancy)}>
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

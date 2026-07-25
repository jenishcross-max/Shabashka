import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { relativeDate } from '../formatDate';
import { formatSalary } from '../components/VacancyCard';

export default function AdminVacancies() {
  const { token } = useAuth();
  const [vacancies, setVacancies] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .adminVacancies(token)
      .then(({ vacancies }) => setVacancies(vacancies))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  async function toggleStatus(v) {
    const nextStatus = v.status === 'open' ? 'closed' : 'open';
    await api.adminSetVacancyStatus(v.id, nextStatus, token);
    load();
  }

  async function togglePinned(v) {
    await api.adminSetVacancyPinned(v.id, !v.pinned, token);
    load();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vacancies;
    return vacancies.filter(
      (v) =>
        v.title.toLowerCase().includes(q) ||
        v.owner_name.toLowerCase().includes(q) ||
        v.city.toLowerCase().includes(q) ||
        v.category.toLowerCase().includes(q)
    );
  }, [vacancies, search]);

  if (loading) return <p className="status-msg">Загрузка…</p>;
  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div>
      <div className="admin-page-head">
        <h1>Вакансии</h1>
        <input
          className="admin-search"
          placeholder="Поиск по вакансиям, работодателям, городу…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="admin-card admin-table-card">
        <div className="admin-table admin-table-orders">
          <div className="admin-table-row admin-table-head admin-table-orders">
            <span>Вакансия</span>
            <span>Работодатель</span>
            <span>Категория</span>
            <span>Город</span>
            <span>Зарплата</span>
            <span>Статус</span>
            <span></span>
          </div>
          {filtered.map((v) => (
            <div className="admin-table-row admin-table-orders" key={v.id}>
              <span>
                <Link to={`/vacancies/${v.id}`} className="strong">
                  {v.pinned ? '🔥 ' : ''}
                  {v.title}
                </Link>
                <div className="admin-subtitle">{relativeDate(v.created_at)}</div>
              </span>
              <span className="admin-subtitle">{v.owner_name}</span>
              <span className="admin-subtitle">{v.category}</span>
              <span className="admin-subtitle">{v.city}</span>
              <span className="admin-subtitle">{formatSalary(v.salary_min, v.salary_max)}</span>
              <span>
                <span className={`badge status-${v.status}`}>
                  {v.status === 'open' ? 'Открыта' : 'Закрыта'}
                </span>
              </span>
              <span className="admin-row-buttons">
                <button className="admin-btn-ghost" onClick={() => togglePinned(v)}>
                  {v.pinned ? 'Открепить' : 'Закрепить'}
                </button>
                <button className="admin-btn-ghost" onClick={() => toggleStatus(v)}>
                  {v.status === 'open' ? 'Скрыть' : 'Открыть'}
                </button>
              </span>
            </div>
          ))}
          {filtered.length === 0 && <p className="status-msg">Ничего не найдено.</p>}
        </div>
      </div>
    </div>
  );
}

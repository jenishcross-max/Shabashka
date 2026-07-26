import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { relativeDate } from '../formatDate';
import { formatSalary } from '../components/VacancyCard';
import Pagination from './Pagination';

export default function AdminVacancies() {
  const { token } = useAuth();
  const [vacancies, setVacancies] = useState([]);
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  function load() {
    setLoading(true);
    api
      .adminVacancies({ page, q: debouncedSearch }, token)
      .then(({ vacancies, ...rest }) => {
        setVacancies(vacancies);
        setMeta(rest);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token, page, debouncedSearch]);

  async function removeVacancy(v) {
    if (!confirm(`Удалить вакансию «${v.title}» (ID ${v.id})? Это действие необратимо.`)) return;
    await api.adminDeleteVacancy(v.id, token);
    load();
  }

  async function togglePinned(v) {
    await api.adminSetVacancyPinned(v.id, !v.pinned, token);
    load();
  }

  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div>
      <div className="admin-page-head">
        <h1>Вакансии</h1>
        <input
          className="admin-search"
          placeholder="Поиск по ID, вакансиям, работодателям, городу…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="admin-card admin-table-card">
        {loading ? (
          <p className="status-msg">Загрузка…</p>
        ) : (
          <div className="admin-table admin-table-orders">
            <div className="admin-table-row admin-table-head admin-table-orders">
              <span>ID</span>
              <span>Вакансия</span>
              <span>Работодатель</span>
              <span>Категория</span>
              <span>Город</span>
              <span>Зарплата</span>
              <span>Статус</span>
              <span></span>
            </div>
            {vacancies.map((v) => (
              <div className="admin-table-row admin-table-orders" key={v.id}>
                <span className="admin-subtitle">#{v.id}</span>
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
                  <button className="admin-btn-danger" onClick={() => removeVacancy(v)}>
                    Скрыть
                  </button>
                </span>
              </div>
            ))}
            {vacancies.length === 0 && <p className="status-msg">Ничего не найдено.</p>}
          </div>
        )}
      </div>
      <Pagination page={meta.page} pages={meta.pages} total={meta.total} onChange={setPage} />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function AdminUsers() {
  const { token } = useAuth();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .adminUsers(token)
      .then(({ users }) => setUsers(users))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  async function toggleBlocked(u) {
    await api.adminSetUserBlocked(u.id, !u.is_blocked, token);
    load();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.city || '').toLowerCase().includes(q)
    );
  }, [users, search]);

  if (loading) return <p className="status-msg">Загрузка…</p>;
  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div>
      <div className="admin-page-head">
        <h1>Пользователи</h1>
        <input
          className="admin-search"
          placeholder="Поиск по имени, email, городу…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="admin-card admin-table-card">
        <div className="admin-table">
          <div className="admin-table-row admin-table-head admin-table-row-actions">
            <span>Пользователь</span>
            <span>Email</span>
            <span>Город</span>
            <span>Заказов</span>
            <span>Статус</span>
            <span></span>
          </div>
          {filtered.map((u) => (
            <div className="admin-table-row admin-table-row-actions" key={u.id}>
              <span className="strong">
                {u.name}
                {u.role === 'admin' && <span className="admin-role-tag">admin</span>}
              </span>
              <span className="admin-subtitle">{u.email}</span>
              <span className="admin-subtitle">{u.city || '—'}</span>
              <span>{u.orders_count}</span>
              <span>
                {u.is_blocked ? (
                  <span className="badge status-closed">Заблокирован</span>
                ) : (
                  <span className="badge status-open">Активен</span>
                )}
              </span>
              <span>
                {u.role !== 'admin' && (
                  <button
                    className={u.is_blocked ? 'admin-btn-ghost' : 'admin-btn-danger'}
                    onClick={() => toggleBlocked(u)}
                  >
                    {u.is_blocked ? 'Разблокировать' : 'Заблокировать'}
                  </button>
                )}
              </span>
            </div>
          ))}
          {filtered.length === 0 && <p className="status-msg">Ничего не найдено.</p>}
        </div>
      </div>
    </div>
  );
}

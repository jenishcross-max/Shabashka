import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import Pagination from './Pagination';
import { SkeletonTableRows } from '../components/Skeleton';

function UserDetailModal({ userId, token, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api
      .adminUserDetail(userId, token)
      .then(setDetail)
      .catch((e) => setError(e.message));
  }

  useEffect(load, [userId, token]);

  async function toggleBlocked() {
    if (!detail) return;
    setBusy(true);
    try {
      await api.adminSetUserBlocked(detail.user.id, !detail.user.is_blocked, token);
      load();
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!detail) return;
    if (!confirm(`Сбросить пароль пользователю ${detail.user.name}? Старый пароль перестанет работать.`)) return;
    setBusy(true);
    setError('');
    try {
      const { password } = await api.adminResetUserPassword(detail.user.id, token);
      setNewPassword(password);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-head">
          <h3>{detail ? detail.user.name : 'Загрузка…'}</h3>
          <button className="admin-modal-close" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>

        {error && <p className="status-msg error">{error}</p>}

        {detail && (
          <>
            <div className="admin-modal-section">
              <h4>Данные</h4>
              <div className="admin-modal-field">
                <span>Email</span>
                <span>{detail.user.email}</span>
              </div>
              <div className="admin-modal-field">
                <span>Телефон</span>
                <span>{detail.user.phone || '—'}</span>
              </div>
              <div className="admin-modal-field">
                <span>Город</span>
                <span>{detail.user.city || '—'}</span>
              </div>
              <div className="admin-modal-field">
                <span>Роль</span>
                <span>{detail.user.role}</span>
              </div>
              <div className="admin-modal-field">
                <span>Регистрация</span>
                <span>{new Date(detail.user.created_at).toLocaleDateString('ru-RU')}</span>
              </div>
              <div className="admin-modal-field">
                <span>Статус</span>
                <span>
                  {detail.user.is_blocked ? (
                    <span className="badge status-closed">Заблокирован</span>
                  ) : (
                    <span className="badge status-open">Активен</span>
                  )}
                </span>
              </div>
            </div>

            <div className="admin-modal-section">
              <h4>Заказы ({detail.orders.length})</h4>
              <div className="admin-modal-list">
                {detail.orders.length === 0 && <span className="admin-subtitle">Нет заказов</span>}
                {detail.orders.map((o) => (
                  <div className="admin-modal-list-item" key={o.id}>
                    <span>{o.title}</span>
                    <span className="admin-subtitle">{o.status}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="admin-modal-section">
              <h4>Вакансии ({detail.vacancies.length})</h4>
              <div className="admin-modal-list">
                {detail.vacancies.length === 0 && <span className="admin-subtitle">Нет вакансий</span>}
                {detail.vacancies.map((v) => (
                  <div className="admin-modal-list-item" key={v.id}>
                    <span>{v.title}</span>
                    <span className="admin-subtitle">{v.status}</span>
                  </div>
                ))}
              </div>
            </div>

            {detail.user.role !== 'admin' && (
              <div className="admin-modal-section">
                <h4>Действия</h4>
                <div className="admin-modal-actions">
                  <button
                    className={detail.user.is_blocked ? 'admin-btn-ghost' : 'admin-btn-danger'}
                    disabled={busy}
                    onClick={toggleBlocked}
                  >
                    {detail.user.is_blocked ? 'Разблокировать' : 'Заблокировать'}
                  </button>
                  <button className="admin-btn-ghost" disabled={busy} onClick={resetPassword}>
                    Сбросить пароль
                  </button>
                </div>
                {newPassword && (
                  <div className="admin-new-password">
                    Новый пароль: {newPassword}
                    <br />
                    <small>Сообщите его пользователю — повторно посмотреть его будет нельзя.</small>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminUsers() {
  const { token } = useAuth();
  const [users, setUsers] = useState([]);
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState(null);

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
      .adminUsers({ page, q: debouncedSearch }, token)
      .then(({ users, ...rest }) => {
        setUsers(users);
        setMeta(rest);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token, page, debouncedSearch]);

  async function toggleBlocked(u) {
    await api.adminSetUserBlocked(u.id, !u.is_blocked, token);
    load();
  }

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
          {loading ? (
            <SkeletonTableRows columns={6} className="admin-table-row-actions" />
          ) : (
            <>
              {users.map((u) => (
                <div
                  className="admin-table-row admin-table-row-actions"
                  key={u.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedUserId(u.id)}
                >
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
                  <span className="admin-row-buttons" onClick={(e) => e.stopPropagation()}>
                    {u.role !== 'admin' && (
                      <button
                        className={u.is_blocked ? 'admin-btn-ghost' : 'admin-btn-danger'}
                        onClick={() => toggleBlocked(u)}
                      >
                        {u.is_blocked ? 'Разблокировать' : 'Заблокировать'}
                      </button>
                    )}
                    <button className="admin-btn-ghost" onClick={() => setSelectedUserId(u.id)}>
                      Просмотр
                    </button>
                  </span>
                </div>
              ))}
              {users.length === 0 && <p className="status-msg">Ничего не найдено.</p>}
            </>
          )}
        </div>
      </div>
      <Pagination page={meta.page} pages={meta.pages} total={meta.total} onChange={setPage} />

      {selectedUserId && (
        <UserDetailModal
          userId={selectedUserId}
          token={token}
          onClose={() => setSelectedUserId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

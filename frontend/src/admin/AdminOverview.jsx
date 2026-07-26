import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

function StatusBadge({ blocked }) {
  return blocked ? (
    <span className="badge status-closed">Заблокирован</span>
  ) : (
    <span className="badge status-open">Активен</span>
  );
}

export default function AdminOverview() {
  const { token } = useAuth();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [reports, setReports] = useState([]);
  const [error, setError] = useState('');

  function load() {
    Promise.all([api.adminStats(token), api.adminUsers({ limit: 4 }, token), api.adminReports(token, 'open')])
      .then(([s, u, r]) => {
        setStats(s);
        setUsers(u.users.slice(0, 4));
        setReports(r.reports.slice(0, 3));
      })
      .catch((e) => setError(e.message));
  }

  useEffect(load, [token]);

  async function resolveReport(id, action) {
    await api.adminResolveReport(id, action, token);
    load();
  }

  if (error) return <p className="status-msg error">{error}</p>;
  if (!stats) return <p className="status-msg">Загрузка…</p>;

  const maxWeek = Math.max(1, ...stats.weekly.map((w) => w.count));
  const maxCategory = Math.max(1, ...stats.topCategories.map((c) => c.count));

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1>Панель управления</h1>
          <p className="admin-subtitle">Обзор всей платформы · обновлено сейчас</p>
        </div>
      </div>

      <div className="admin-stat-grid">
        <div className="admin-stat-card">
          <div className="admin-stat-label">Пользователей</div>
          <div className="admin-stat-value">{stats.usersCount}</div>
          <div className="admin-stat-delta positive">▲ +{stats.newUsers30d} за месяц</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Активных заказов</div>
          <div className="admin-stat-value">{stats.activeOrders}</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Активных вакансий</div>
          <div className="admin-stat-value">{stats.activeVacancies}</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Заказов сегодня</div>
          <div className="admin-stat-value">{stats.ordersToday}</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Открытых жалоб</div>
          <div className="admin-stat-value warn">{stats.openReports}</div>
          <div className="admin-stat-delta negative">Требуют проверки</div>
        </div>
      </div>

      <div className="admin-split">
        <div className="admin-card">
          <div className="admin-card-head">
            <h3>Новые заказы по неделям</h3>
          </div>
          <div className="admin-chart">
            {stats.weekly.map((w, i) => (
              <div className="admin-chart-col" key={w.week}>
                <div className="admin-chart-bar" style={{ height: `${(w.count / maxWeek) * 100}%` }} />
                <span>Н{i + 1}</span>
              </div>
            ))}
            {stats.weekly.length === 0 && <p className="status-msg">Пока нет данных</p>}
          </div>
        </div>
        <div className="admin-card">
          <div className="admin-card-head">
            <h3>Топ категорий</h3>
          </div>
          <div className="admin-cat-list">
            {stats.topCategories.map((c) => (
              <div key={c.category} className="admin-cat-row">
                <div className="admin-cat-row-top">
                  <span>{c.category}</span>
                  <span className="admin-subtitle">{c.count}</span>
                </div>
                <div className="admin-progress">
                  <div className="admin-progress-fill" style={{ width: `${(c.count / maxCategory) * 100}%` }} />
                </div>
              </div>
            ))}
            {stats.topCategories.length === 0 && <p className="status-msg">Пока нет данных</p>}
          </div>
        </div>
      </div>

      <div className="admin-card admin-table-card">
        <div className="admin-card-head">
          <h3>Последние пользователи</h3>
          <Link to="/admin/users">Все пользователи →</Link>
        </div>
        <div className="admin-table">
          <div className="admin-table-row admin-table-head">
            <span>Пользователь</span>
            <span>Email</span>
            <span>Город</span>
            <span>Заказов</span>
            <span>Статус</span>
          </div>
          {users.map((u) => (
            <div className="admin-table-row" key={u.id}>
              <span className="strong">{u.name}</span>
              <span className="admin-subtitle">{u.email}</span>
              <span className="admin-subtitle">{u.city || '—'}</span>
              <span>{u.orders_count}</span>
              <span>
                <StatusBadge blocked={!!u.is_blocked} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card-head">
          <h3>Жалобы на модерации</h3>
        </div>
        {reports.length === 0 && <p className="status-msg">Открытых жалоб нет.</p>}
        <div className="admin-complaints">
          {reports.map((r) => (
            <div key={r.id} className="admin-complaint">
              <div className="admin-complaint-text">
                <div className="strong">
                  Заказ «{r.order_title}» — {r.reason}
                </div>
                <div className="admin-subtitle">{new Date(r.created_at).toLocaleString('ru-RU')}</div>
              </div>
              <div className="admin-complaint-actions">
                <button className="admin-btn-danger" onClick={() => resolveReport(r.id, 'hide')}>
                  Скрыть заказ
                </button>
                <button className="admin-btn-ghost" onClick={() => resolveReport(r.id, 'dismiss')}>
                  Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

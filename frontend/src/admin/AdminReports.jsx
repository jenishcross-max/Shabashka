import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function AdminReports() {
  const { token } = useAuth();
  const [reports, setReports] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .adminReports(token, showAll ? 'all' : 'open')
      .then(({ reports }) => setReports(reports))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token, showAll]);

  async function resolve(id, action) {
    await api.adminResolveReport(id, action, token);
    load();
  }

  if (loading) return <p className="status-msg">Загрузка…</p>;
  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div>
      <div className="admin-page-head">
        <h1>Жалобы на модерации</h1>
        <button className="admin-btn-ghost" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Только открытые' : 'Показать все'}
        </button>
      </div>
      {reports.length === 0 && <p className="status-msg">Жалоб нет.</p>}
      <div className="admin-complaints">
        {reports.map((r) => (
          <div key={r.id} className={`admin-complaint${r.resolved ? ' resolved' : ''}`}>
            <div className="admin-complaint-text">
              <div className="strong">
                Заказ «
                <Link to={`/orders/${r.order_id}`}>{r.order_title}</Link>» — {r.reason}
              </div>
              <div className="admin-subtitle">
                {new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleString('ru-RU')}
                {r.resolved && ' · решено'}
              </div>
            </div>
            {!r.resolved && (
              <div className="admin-complaint-actions">
                <button className="admin-btn-danger" onClick={() => resolve(r.id, 'hide')}>
                  Скрыть заказ
                </button>
                <button className="admin-btn-ghost" onClick={() => resolve(r.id, 'dismiss')}>
                  Отклонить
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

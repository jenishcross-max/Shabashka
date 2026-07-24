import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { relativeDate } from '../formatDate';

export default function AdminOrders() {
  const { token } = useAuth();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api
      .adminOrders(token)
      .then(({ orders }) => setOrders(orders))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  async function toggleStatus(order) {
    const nextStatus = order.status === 'open' ? 'closed' : 'open';
    await api.adminSetOrderStatus(order.id, nextStatus, token);
    load();
  }

  if (loading) return <p className="status-msg">Загрузка…</p>;
  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div>
      <div className="admin-page-head">
        <h1>Все заказы</h1>
      </div>
      <div className="admin-card admin-table-card">
        <div className="admin-table admin-table-orders">
          <div className="admin-table-row admin-table-head admin-table-orders">
            <span>Заказ</span>
            <span>Заказчик</span>
            <span>Категория</span>
            <span>Город</span>
            <span>Статус</span>
            <span></span>
          </div>
          {orders.map((o) => (
            <div className="admin-table-row admin-table-orders" key={o.id}>
              <span>
                <Link to={`/orders/${o.id}`} className="strong">
                  {o.title}
                </Link>
                <div className="admin-subtitle">{relativeDate(o.created_at)}</div>
              </span>
              <span className="admin-subtitle">{o.owner_name}</span>
              <span className="admin-subtitle">{o.category}</span>
              <span className="admin-subtitle">{o.city}</span>
              <span>
                <span className={`badge status-${o.status}`}>{o.status === 'open' ? 'Открыт' : 'Закрыт'}</span>
              </span>
              <span>
                <button className="admin-btn-ghost" onClick={() => toggleStatus(o)}>
                  {o.status === 'open' ? 'Скрыть' : 'Открыть'}
                </button>
              </span>
            </div>
          ))}
          {orders.length === 0 && <p className="status-msg">Заказов пока нет.</p>}
        </div>
      </div>
    </div>
  );
}

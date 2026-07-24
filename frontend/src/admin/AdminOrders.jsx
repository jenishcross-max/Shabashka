import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { relativeDate } from '../formatDate';

export default function AdminOrders() {
  const { token } = useAuth();
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
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

  async function togglePinned(order) {
    await api.adminSetOrderPinned(order.id, !order.pinned, token);
    load();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        o.title.toLowerCase().includes(q) ||
        o.owner_name.toLowerCase().includes(q) ||
        o.city.toLowerCase().includes(q) ||
        o.category.toLowerCase().includes(q)
    );
  }, [orders, search]);

  if (loading) return <p className="status-msg">Загрузка…</p>;
  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div>
      <div className="admin-page-head">
        <h1>Все заказы</h1>
        <input
          className="admin-search"
          placeholder="Поиск по заказам, заказчикам, городу…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="admin-card admin-table-card">
        <div className="admin-table admin-table-orders">
          <div className="admin-table-row admin-table-head admin-table-orders">
            <span>Заказ</span>
            <span>Заказчик</span>
            <span>Категория</span>
            <span>Город</span>
            <span>Просмотров</span>
            <span>Статус</span>
            <span></span>
          </div>
          {filtered.map((o) => (
            <div className="admin-table-row admin-table-orders" key={o.id}>
              <span>
                <Link to={`/orders/${o.id}`} className="strong">
                  {o.pinned ? '🔥 ' : ''}
                  {o.title}
                </Link>
                <div className="admin-subtitle">{relativeDate(o.created_at)}</div>
              </span>
              <span className="admin-subtitle">{o.owner_name}</span>
              <span className="admin-subtitle">{o.category}</span>
              <span className="admin-subtitle">{o.city}</span>
              <span className="admin-subtitle">{o.views}</span>
              <span>
                <span className={`badge status-${o.status}`}>{o.status === 'open' ? 'Открыт' : 'Закрыт'}</span>
              </span>
              <span className="admin-row-buttons">
                <button className="admin-btn-ghost" onClick={() => togglePinned(o)}>
                  {o.pinned ? 'Открепить' : 'Закрепить'}
                </button>
                <button className="admin-btn-ghost" onClick={() => toggleStatus(o)}>
                  {o.status === 'open' ? 'Скрыть' : 'Открыть'}
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

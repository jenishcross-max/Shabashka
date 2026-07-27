import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { relativeDate } from '../formatDate';
import MyListingsTabs from '../components/MyListingsTabs';
import { SkeletonMyOrderRow } from '../components/Skeleton';

export default function MyOrders() {
  const { token } = useAuth();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [bumpError, setBumpError] = useState('');
  const [togglingId, setTogglingId] = useState(null);

  function load() {
    setLoading(true);
    api
      .myOrders(token)
      .then(({ orders }) => setOrders(orders))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  async function toggleStatus(order) {
    const nextStatus = order.status === 'open' ? 'closed' : 'open';
    setTogglingId(order.id);
    try {
      await api.setOrderStatus(order.id, nextStatus, token);
      load();
    } finally {
      setTogglingId(null);
    }
  }

  async function remove(order) {
    if (!confirm('Удалить этот заказ?')) return;
    await api.deleteOrder(order.id, token);
    load();
  }

  async function bump(order) {
    setBumpError('');
    try {
      await api.bumpOrder(order.id, token);
      load();
    } catch (e) {
      setBumpError(e.message);
    }
  }

  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div>
      <MyListingsTabs active="orders" />
      <div className="my-orders-head">
        <h1>Мои заказы</h1>
        <Link to="/orders/new" className="cta">
          + Новый заказ
        </Link>
      </div>
      {!loading && orders.length === 0 && (
        <p className="status-msg">
          У вас пока нет заказов. <Link to="/orders/new">Разместить первый заказ</Link>
        </p>
      )}
      {bumpError && <p className="status-msg error">{bumpError}</p>}
      <div className="my-orders-list">
        {loading && (
          <>
            <SkeletonMyOrderRow />
            <SkeletonMyOrderRow />
            <SkeletonMyOrderRow />
          </>
        )}
        {!loading && orders.map((order) => (
          <div key={order.id} className={`my-order-row${order.status === 'closed' ? ' closed' : ''}`}>
            <div>
              <div className="my-order-title-row">
                <Link to={`/orders/${order.id}`}>{order.title}</Link>
                <span className={`badge status-${order.status}`}>
                  {order.status === 'open' ? 'Открыт' : 'Закрыт'}
                </span>
              </div>
              <div className="my-order-meta">
                {order.category} · {order.city} ·{' '}
                {order.budget ? `${order.budget.toLocaleString('ru-RU')} сом` : 'по договорённости'} ·{' '}
                {relativeDate(order.created_at)} · 👁 {order.views}
              </div>
            </div>
            <div className="my-order-actions">
              <Link to={`/orders/${order.id}/edit`}>Изменить</Link>
              <button onClick={() => bump(order)}>⬆ Поднять</button>
              <button disabled={togglingId === order.id} onClick={() => toggleStatus(order)}>
                {togglingId === order.id
                  ? '…'
                  : order.status === 'open'
                  ? 'Закрыть'
                  : 'Открыть снова'}
              </button>
              <button className="danger" onClick={() => remove(order)}>
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

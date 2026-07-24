import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';

export default function MyOrders() {
  const { token } = useAuth();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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
    await api.setOrderStatus(order.id, nextStatus, token);
    load();
  }

  async function remove(order) {
    if (!confirm('Удалить этот заказ?')) return;
    await api.deleteOrder(order.id, token);
    load();
  }

  if (loading) return <p className="status-msg">Загрузка…</p>;
  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div>
      <h1>Мои заказы</h1>
      {orders.length === 0 && (
        <p className="status-msg">
          У вас пока нет заказов. <Link to="/orders/new">Разместить первый заказ</Link>
        </p>
      )}
      <div className="my-orders-list">
        {orders.map((order) => (
          <div key={order.id} className="my-order-row">
            <div>
              <Link to={`/orders/${order.id}`}>{order.title}</Link>
              <span className={`status-tag ${order.status}`}>
                {order.status === 'open' ? 'Открыт' : 'Закрыт'}
              </span>
            </div>
            <div className="my-order-actions">
              <button onClick={() => toggleStatus(order)}>
                {order.status === 'open' ? 'Закрыть заказ' : 'Открыть снова'}
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

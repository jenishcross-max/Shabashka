import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFavorites } from '../context/FavoritesContext';
import OrderCard from '../components/OrderCard';

export default function Favorites() {
  const { ids } = useFavorites();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (ids.length === 0) {
      setOrders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .ordersBatch(ids)
      .then(({ orders }) => setOrders(orders))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.length]);

  return (
    <div>
      <div className="my-orders-head">
        <h1>Избранное</h1>
      </div>
      {loading && <p className="status-msg">Загрузка…</p>}
      {!loading && ids.length === 0 && (
        <p className="status-msg">
          Пока нет сохранённых заказов. Нажмите ☆ на карточке заказа, чтобы добавить его сюда.{' '}
          <Link to="/">Смотреть заказы</Link>
        </p>
      )}
      <div className="order-grid">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
      </div>
    </div>
  );
}

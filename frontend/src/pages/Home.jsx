import { useEffect, useState } from 'react';
import { api } from '../api';
import OrderCard from '../components/OrderCard';

export default function Home() {
  const [orders, setOrders] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState({ category: '', city: '', q: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.categories().then(({ categories }) => setCategories(categories));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    const handle = setTimeout(() => {
      api
        .orders(filters)
        .then(({ orders }) => setOrders(orders))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [filters]);

  return (
    <div>
      <section className="hero">
        <h1>Найдите подработку или исполнителя в Кыргызстане</h1>
        <p>
          Заказчики размещают задачи на сайте, исполнители сами связываются с ними через WhatsApp —
          никакой регистрации для отклика не нужно.
        </p>
      </section>

      <div className="filters">
        <input
          type="text"
          placeholder="Поиск по заказам…"
          value={filters.q}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
        />
        <select
          value={filters.category}
          onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
        >
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Город"
          value={filters.city}
          onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value }))}
        />
      </div>

      {loading && <p className="status-msg">Загрузка заказов…</p>}
      {error && <p className="status-msg error">{error}</p>}
      {!loading && !error && orders.length === 0 && (
        <p className="status-msg">Пока нет заказов по этим фильтрам.</p>
      )}

      <div className="order-grid">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
      </div>
    </div>
  );
}

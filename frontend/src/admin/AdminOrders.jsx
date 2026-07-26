import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { relativeDate } from '../formatDate';
import Pagination from './Pagination';

export default function AdminOrders() {
  const { token } = useAuth();
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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
      .adminOrders({ page, q: debouncedSearch }, token)
      .then(({ orders, ...rest }) => {
        setOrders(orders);
        setMeta(rest);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token, page, debouncedSearch]);

  async function removeOrder(order) {
    if (!confirm(`Удалить заказ «${order.title}» (ID ${order.id})? Это действие необратимо.`)) return;
    await api.adminDeleteOrder(order.id, token);
    load();
  }

  async function togglePinned(order) {
    await api.adminSetOrderPinned(order.id, !order.pinned, token);
    load();
  }

  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div>
      <div className="admin-page-head">
        <h1>Все заказы</h1>
        <input
          className="admin-search"
          placeholder="Поиск по ID, заказам, заказчикам, городу…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="admin-card admin-table-card">
        {loading ? (
          <p className="status-msg">Загрузка…</p>
        ) : (
          <div className="admin-table admin-table-orders">
            <div className="admin-table-row admin-table-head admin-table-orders">
              <span>ID</span>
              <span>Заказ</span>
              <span>Заказчик</span>
              <span>Категория</span>
              <span>Город</span>
              <span>Просмотров</span>
              <span>Статус</span>
              <span></span>
            </div>
            {orders.map((o) => (
              <div className="admin-table-row admin-table-orders" key={o.id}>
                <span className="admin-subtitle">#{o.id}</span>
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
                  <button className="admin-btn-danger" onClick={() => removeOrder(o)}>
                    Скрыть
                  </button>
                </span>
              </div>
            ))}
            {orders.length === 0 && <p className="status-msg">Ничего не найдено.</p>}
          </div>
        )}
      </div>
      <Pagination page={meta.page} pages={meta.pages} total={meta.total} onChange={setPage} />
    </div>
  );
}

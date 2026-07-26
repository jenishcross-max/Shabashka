import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFavorites } from '../context/FavoritesContext';
import OrderCard from '../components/OrderCard';
import VacancyCard from '../components/VacancyCard';
import { SkeletonOrderCard } from '../components/Skeleton';

export default function Favorites() {
  const { orderIds, vacancyIds } = useFavorites();
  const [orders, setOrders] = useState([]);
  const [vacancies, setVacancies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      orderIds.length ? api.ordersBatch(orderIds) : Promise.resolve({ orders: [] }),
      vacancyIds.length ? api.vacanciesBatch(vacancyIds) : Promise.resolve({ vacancies: [] }),
    ])
      .then(([o, v]) => {
        setOrders(o.orders);
        setVacancies(v.vacancies);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderIds.length, vacancyIds.length]);

  const isEmpty = orderIds.length === 0 && vacancyIds.length === 0;

  return (
    <div>
      <div className="my-orders-head">
        <h1>Избранное</h1>
      </div>
      {loading && (
        <section className="section">
          <div className="order-grid">
            <SkeletonOrderCard />
            <SkeletonOrderCard />
            <SkeletonOrderCard />
          </div>
        </section>
      )}
      {!loading && isEmpty && (
        <p className="status-msg">
          Пока нет сохранённых заказов и вакансий. Нажмите ☆ на карточке, чтобы добавить сюда.{' '}
          <Link to="/orders">Смотреть заказы</Link> · <Link to="/vacancies">Смотреть вакансии</Link>
        </p>
      )}

      {!loading && orders.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Заказы</h2>
          </div>
          <div className="order-grid">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </section>
      )}

      {vacancies.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Вакансии</h2>
          </div>
          <div className="order-grid">
            {vacancies.map((v) => (
              <VacancyCard key={v.id} vacancy={v} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

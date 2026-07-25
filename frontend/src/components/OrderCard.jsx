import { Link } from 'react-router-dom';
import { relativeDate } from '../formatDate';
import FavoriteButton from './FavoriteButton';

export default function OrderCard({ order }) {
  return (
    <Link to={`/orders/${order.id}`} className="order-card">
      <div className="order-card-top">
        <div className="order-card-badges">
          <span className="badge">{order.category}</span>
          <span className="badge">{order.work_format === 'online' ? '🌐 Онлайн' : '📍 Офлайн'}</span>
          {!!order.pinned && <span className="badge pinned">🔥 Топ</span>}
        </div>
        <span className="order-city">{order.city}</span>
      </div>
      <h3>{order.title}</h3>
      <p>{order.description}</p>
      <div className="order-card-bottom">
        {order.budget ? (
          <span className="budget">{order.budget.toLocaleString('ru-RU')} сом</span>
        ) : (
          <span className="budget muted-budget">По договорённости</span>
        )}
        <span className="date">{relativeDate(order.created_at)}</span>
      </div>
      <FavoriteButton type="order" id={order.id} className="order-card-fav" />
    </Link>
  );
}

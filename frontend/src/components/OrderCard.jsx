import { Link } from 'react-router-dom';
import { relativeDate } from '../formatDate';

export default function OrderCard({ order }) {
  return (
    <Link to={`/orders/${order.id}`} className="order-card">
      <div className="order-card-top">
        <span className="badge">{order.category}</span>
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
    </Link>
  );
}

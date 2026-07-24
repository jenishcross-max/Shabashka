import { Link } from 'react-router-dom';

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
        <span className="budget">{order.budget ? `${order.budget} сом` : 'Бюджет по договорённости'}</span>
        <span className="date">{new Date(order.created_at).toLocaleDateString('ru-RU')}</span>
      </div>
    </Link>
  );
}

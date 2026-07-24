import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';

function waLink(phone, title) {
  const digits = phone.replace(/[^\d]/g, '');
  const text = encodeURIComponent(`Здравствуйте! Пишу по заказу «${title}» на Шабашка КГ.`);
  return `https://wa.me/${digits}?text=${text}`;
}

export default function OrderDetail() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .order(id)
      .then(({ order }) => setOrder(order))
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="status-msg error">{error}</p>;
  if (!order) return <p className="status-msg">Загрузка…</p>;

  return (
    <div className="order-detail">
      <Link to="/" className="back-link">
        ← Ко всем заказам
      </Link>
      <span className="badge">{order.category}</span>
      <h1>{order.title}</h1>
      <p className="meta">
        {order.city} · {new Date(order.created_at).toLocaleDateString('ru-RU')} · Заказчик: {order.owner_name}
      </p>
      <p className="description">{order.description}</p>
      <p className="budget-line">
        {order.budget ? `Бюджет: ${order.budget} сом` : 'Бюджет по договорённости'}
      </p>

      {order.status === 'closed' ? (
        <p className="status-msg">Этот заказ уже закрыт заказчиком.</p>
      ) : (
        <a
          className="whatsapp-btn"
          href={waLink(order.whatsapp_phone, order.title)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Написать в WhatsApp
        </a>
      )}
      <p className="hint">
        Отклик не требует регистрации — просто напишите заказчику напрямую в WhatsApp.
      </p>
    </div>
  );
}

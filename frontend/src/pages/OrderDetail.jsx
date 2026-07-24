import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { relativeDate } from '../formatDate';
import { imageUrl } from '../imageUrl';
import { useAuth } from '../context/AuthContext';
import FavoriteButton from '../components/FavoriteButton';
import OrderCard from '../components/OrderCard';

function waLink(phone, title) {
  const digits = phone.replace(/[^\d]/g, '');
  const text = encodeURIComponent(`Здравствуйте! Пишу по заказу «${title}» на Шабашка.kg.`);
  return `https://wa.me/${digits}?text=${text}`;
}

export default function OrderDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [order, setOrder] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [error, setError] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const [reportMsg, setReportMsg] = useState('');

  useEffect(() => {
    api
      .order(id)
      .then(({ order }) => setOrder(order))
      .catch((e) => setError(e.message));
    api
      .similarOrders(id)
      .then(({ orders }) => setSimilar(orders))
      .catch(() => {});
  }, [id]);

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: order.title, url });
      } catch {
        // пользователь отменил — ничего не делаем
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    setShareMsg('Ссылка скопирована');
    setTimeout(() => setShareMsg(''), 2500);
  }

  async function handleReport() {
    const reason = window.prompt('Опишите, что не так с этим заказом:');
    if (!reason || !reason.trim()) return;
    await api.reportOrder(order.id, reason);
    setReportMsg('Спасибо, жалоба отправлена на проверку');
    setTimeout(() => setReportMsg(''), 3000);
  }

  if (error) return <p className="status-msg error">{error}</p>;
  if (!order) return <p className="status-msg">Загрузка…</p>;

  const photo = imageUrl(order.image_path);
  const isOwner = user?.id === order.user_id;

  return (
    <div className="order-detail-wrap">
      <Link to="/" className="back-link">
        ← Ко всем заказам
      </Link>
      <div className="order-detail">
        {photo && <img src={photo} alt={order.title} className="order-detail-photo" />}
        <div className="badges-row">
          <span className="badge">{order.category}</span>
          <span className={`badge status-${order.status}`}>
            {order.status === 'open' ? 'Открыт' : 'Закрыт'}
          </span>
          {!!order.pinned && <span className="badge pinned">🔥 Топ</span>}
          <FavoriteButton orderId={order.id} className="order-detail-fav" />
        </div>
        <h1>{order.title}</h1>
        <p className="meta">
          <span>📍 {order.city}</span>
          <span>🗓 Опубликован {relativeDate(order.created_at)}</span>
          <span>👤 Заказчик: {order.owner_name}</span>
          <span>👁 {order.views} просмотров</span>
        </p>

        <div className="budget-box">
          <span className="label">Бюджет</span>
          <span className="value">
            {order.budget ? `${order.budget.toLocaleString('ru-RU')} сом` : 'По договорённости'}
          </span>
        </div>

        <h3 className="desc-heading">Описание задачи</h3>
        <p className="description">{order.description}</p>

        {order.status === 'closed' ? (
          <p className="status-msg">Этот заказ уже закрыт заказчиком.</p>
        ) : (
          <a
            className="whatsapp-btn"
            href={waLink(order.whatsapp_phone, order.title)}
            target="_blank"
            rel="noopener noreferrer"
          >
            💬 Написать в WhatsApp
          </a>
        )}

        <div className="secondary-actions">
          <button type="button" onClick={handleShare}>
            🔗 {shareMsg || 'Поделиться'}
          </button>
          {isOwner ? (
            <Link to={`/orders/${order.id}/edit`} className="admin-btn-ghost secondary-link">
              ✏️ Изменить заказ
            </Link>
          ) : (
            <button type="button" className="muted" onClick={handleReport}>
              ⚑ {reportMsg || 'Пожаловаться'}
            </button>
          )}
        </div>

        <p className="hint">Отклик не требует регистрации — просто напишите заказчику напрямую.</p>
      </div>

      {similar.length > 0 && (
        <div className="similar-orders">
          <h2>Похожие заказы</h2>
          <div className="order-grid">
            {similar.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

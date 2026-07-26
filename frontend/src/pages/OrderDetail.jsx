import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { relativeDate } from '../formatDate';
import { useAuth } from '../context/AuthContext';
import FavoriteButton from '../components/FavoriteButton';
import OrderCard from '../components/OrderCard';
import FormatIcon from '../components/FormatIcon';
import { SkeletonOrderDetail } from '../components/Skeleton';

function waLink(phone, title) {
  const digits = phone.replace(/[^\d]/g, '');
  const text = encodeURIComponent(`Здравствуйте! Пишу по заказу «${title}» на Шабашка.`);
  return `https://wa.me/${digits}?text=${text}`;
}

export default function OrderDetail() {
  const { id } = useParams();
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [error, setError] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const [reportMsg, setReportMsg] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

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

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    setSendError('');
    setSending(true);
    try {
      const { conversation } = await api.startOrderConversation(order.id, draft, token);
      navigate(`/messages/${conversation.id}`);
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (error) return <p className="status-msg error">{error}</p>;
  if (!order) return <SkeletonOrderDetail />;

  const isOwner = user?.id === order.user_id;

  return (
    <div className="order-detail-wrap">
      <Link to="/orders" className="back-link">
        ← Ко всем заказам
      </Link>
      <div className="order-detail">
        <div className="badges-row">
          <span className="badge">{order.category}</span>
          <span className={`badge status-${order.status}`}>
            {order.status === 'open' ? 'Открыт' : 'Закрыт'}
          </span>
          {!!order.pinned && <span className="badge pinned">🔥 Топ</span>}
          <FavoriteButton type="order" id={order.id} className="order-detail-fav" />
        </div>
        <h1>{order.title}</h1>
        <p className="meta">
          <span>📍 {order.city}{order.address ? `, ${order.address}` : ''}</span>
          <span><FormatIcon name={order.work_format === 'online' ? 'online' : 'offline'} size={15} /> {order.work_format === 'online' ? 'Онлайн' : 'Офлайн'}</span>
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
          <>
            {order.whatsapp_phone && (
              <a
                className="whatsapp-btn"
                href={waLink(order.whatsapp_phone, order.title)}
                target="_blank"
                rel="noopener noreferrer"
              >
                💬 Написать в WhatsApp
              </a>
            )}

            {!isOwner && (
              <div className="apply-box">
                <h3>Или напишите прямо здесь</h3>
                {user ? (
                  <form onSubmit={handleSendMessage}>
                    <textarea
                      rows={3}
                      maxLength={2000}
                      placeholder="Расскажите коротко, чем можете помочь — заказчик ответит в этой переписке."
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    {sendError && <p className="status-msg error">{sendError}</p>}
                    <button className="submit-btn" type="submit" disabled={sending || !draft.trim()}>
                      {sending ? 'Отправляем…' : 'Отправить сообщение'}
                    </button>
                  </form>
                ) : (
                  <p className="apply-login-hint">
                    <Link to="/login" state={{ from: { pathname: `/orders/${order.id}` } }}>
                      Войдите
                    </Link>{' '}
                    или <Link to="/register">зарегистрируйтесь</Link>, чтобы переписываться с
                    заказчиком на сайте.
                    {order.whatsapp_phone ? ' Написать в WhatsApp можно и без аккаунта.' : ''}
                  </p>
                )}
              </div>
            )}
          </>
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

        <p className="hint">
          {order.whatsapp_phone
            ? 'В WhatsApp можно написать без регистрации. Переписка на сайте — для тех, кто вошёл в аккаунт.'
            : 'Заказчик не указал WhatsApp — написать можно только через переписку на сайте, для этого нужен аккаунт.'}
        </p>
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

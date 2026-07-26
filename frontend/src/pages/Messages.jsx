import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { relativeDate } from '../formatDate';
import { SkeletonConversationRow } from '../components/Skeleton';

export default function Messages() {
  const { token } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .conversations(token)
      .then(({ conversations }) => setConversations(conversations))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div className="messages-page">
      <h1>Сообщения</h1>
      {loading && (
        <div className="conversation-list">
          <SkeletonConversationRow />
          <SkeletonConversationRow />
          <SkeletonConversationRow />
        </div>
      )}
      {!loading && conversations.length === 0 && (
        <p className="status-msg">
          Пока нет переписок. Откликнитесь на <Link to="/orders">заказ</Link> или{' '}
          <Link to="/vacancies">вакансию</Link>, чтобы написать автору объявления.
        </p>
      )}
      {!loading && conversations.length > 0 && (
        <div className="conversation-list">
          {conversations.map((c) => (
            <Link key={c.id} to={`/messages/${c.id}`} className="conversation-row">
              <div className="conversation-main">
                <div className="conversation-top">
                  <span className="conversation-name">{c.other_name}</span>
                  <span className="conversation-date">{relativeDate(c.last_message_at)}</span>
                </div>
                <div className="conversation-vacancy">
                  {c.listing_type === 'order' ? 'Заказ: ' : 'Вакансия: '}
                  {c.listing_title}
                </div>
                <div className="conversation-preview">{c.last_message}</div>
              </div>
              {c.unread > 0 && <span className="conversation-unread">{c.unread}</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

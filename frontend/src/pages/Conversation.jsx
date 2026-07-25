import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useUnread } from '../context/UnreadContext';

function messageTime(iso) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Conversation() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const { refreshUnread } = useUnread();
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    api
      .conversation(id, token)
      .then(({ conversation, messages }) => {
        setConversation(conversation);
        setMessages(messages);
        // сервер только что пометил входящие прочитанными — обновляем значок
        refreshUnread();
      })
      .catch((e) => setLoadError(e.message));
  }, [id, token, refreshUnread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    setError('');
    setSending(true);
    try {
      const { message } = await api.sendMessage(id, draft, token);
      setMessages((prev) => [...prev, message]);
      setDraft('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (loadError) return <p className="status-msg error">{loadError}</p>;
  if (!conversation) return <p className="status-msg">Загрузка…</p>;

  const waDigits = conversation.other_phone?.replace(/[^\d]/g, '');

  return (
    <div className="conversation-page">
      <Link to="/messages" className="back-link">
        ← Ко всем сообщениям
      </Link>

      <div className="conversation-header">
        <div>
          <h1>{conversation.other_name}</h1>
          <p className="conversation-subtitle">
            {conversation.my_role === 'seeker' ? 'Работодатель · ' : 'Соискатель · '}
            <Link to={`/vacancies/${conversation.vacancy_id}`}>{conversation.vacancy_title}</Link>
          </p>
        </div>
        {waDigits && (
          <a
            className="admin-btn-ghost"
            href={`https://wa.me/${waDigits}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            💬 WhatsApp
          </a>
        )}
      </div>

      <div className="message-thread">
        {messages.map((m) => (
          <div key={m.id} className={`message-bubble${m.sender_id === user?.id ? ' mine' : ''}`}>
            <div className="message-body">{m.body}</div>
            <div className="message-time">{messageTime(m.created_at)}</div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <p className="status-msg error">{error}</p>}

      <form className="message-form" onSubmit={handleSend}>
        <textarea
          rows={2}
          placeholder="Написать сообщение…"
          maxLength={2000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={sending || !draft.trim()}>
          {sending ? 'Отправляем…' : 'Отправить'}
        </button>
      </form>
    </div>
  );
}

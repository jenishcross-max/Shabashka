import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { relativeDate } from '../formatDate';
import { useAuth } from '../context/AuthContext';
import { employmentLabel } from '../employmentTypes';
import { experienceLabel } from '../experienceLevels';
import { formatSalary } from '../components/VacancyCard';
import FavoriteButton from '../components/FavoriteButton';
import FormatIcon from '../components/FormatIcon';
import { SkeletonOrderDetail } from '../components/Skeleton';

function waLink(phone, title) {
  const digits = phone.replace(/[^\d]/g, '');
  const text = encodeURIComponent(`Здравствуйте! Пишу по вакансии «${title}» на Шабашка.`);
  return `https://wa.me/${digits}?text=${text}`;
}

export default function VacancyDetail() {
  const { id } = useParams();
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const [vacancy, setVacancy] = useState(null);
  const [error, setError] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    api
      .vacancy(id)
      .then(({ vacancy }) => setVacancy(vacancy))
      .catch((e) => setError(e.message));
  }, [id]);

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: vacancy.title, url });
      } catch {
        // пользователь отменил
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    setShareMsg('Ссылка скопирована');
    setTimeout(() => setShareMsg(''), 2500);
  }

  async function handleSendMessage(e) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    setSendError('');
    setSending(true);
    try {
      const { conversation } = await api.startVacancyConversation(vacancy.id, draft, token);
      navigate(`/messages/${conversation.id}`);
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (error) return <p className="status-msg error">{error}</p>;
  if (!vacancy) return <SkeletonOrderDetail />;

  const isOwner = user?.id === vacancy.user_id;

  return (
    <div className="order-detail-wrap">
      <Link to="/vacancies" className="back-link">
        ← Ко всем вакансиям
      </Link>
      <div className="order-detail">
        <div className="badges-row">
          <span className="badge">{vacancy.category}</span>
          <span className={`badge status-${vacancy.status}`}>
            {vacancy.status === 'open' ? 'Открыта' : 'Закрыта'}
          </span>
          {!!vacancy.pinned && <span className="badge pinned">🔥 Топ</span>}
          {!!vacancy.is_example && <span className="badge badge-example">Пример</span>}
          <FavoriteButton type="vacancy" id={vacancy.id} className="order-detail-fav" />
        </div>
        <h1>{vacancy.title}</h1>
        <p className="meta">
          <span>💼 {employmentLabel(vacancy.employment_type)}</span>
          <span><FormatIcon name={vacancy.work_format === 'online' ? 'online' : 'offline'} size={15} /> {vacancy.work_format === 'online' ? 'Онлайн' : 'Офлайн'}</span>
          <span>🎯 Опыт: {experienceLabel(vacancy.experience)}</span>
          <span>
            📍 {vacancy.city}
            {vacancy.address ? `, ${vacancy.address}` : ''}
          </span>
          {vacancy.schedule && <span>🗓 {vacancy.schedule}</span>}
          <span>👤 Работодатель: {vacancy.owner_name}</span>
          <span>👁 {vacancy.views} просмотров</span>
        </p>

        <div className="budget-box">
          <span className="label">Зарплата</span>
          <span className="value">{formatSalary(vacancy.salary_min, vacancy.salary_max)}</span>
        </div>

        <h3 className="desc-heading">Обязанности</h3>
        <p className="description">{vacancy.description}</p>

        {vacancy.requirements && (
          <>
            <h3 className="desc-heading">Требования</h3>
            <p className="description">{vacancy.requirements}</p>
          </>
        )}

        {vacancy.conditions && (
          <>
            <h3 className="desc-heading">Условия</h3>
            <p className="description">{vacancy.conditions}</p>
          </>
        )}

        {vacancy.is_example ? (
          <p className="status-msg">
            Это пример вакансии — он показывает, как выглядит реальное объявление. Откликнуться
            нельзя, отклики на него никто не увидит.
          </p>
        ) : vacancy.status === 'closed' ? (
          <p className="status-msg">Эта вакансия уже закрыта.</p>
        ) : (
          <>
            {vacancy.whatsapp_phone && (
              <a
                className="whatsapp-btn"
                href={waLink(vacancy.whatsapp_phone, vacancy.title)}
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
                      placeholder="Расскажите коротко о себе и опыте — работодатель ответит в этой переписке."
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    {sendError && <p className="status-msg error">{sendError}</p>}
                    <button className="submit-btn" type="submit" disabled={sending || !draft.trim()}>
                      {sending ? 'Отправляем…' : 'Отправить отклик'}
                    </button>
                  </form>
                ) : (
                  <p className="apply-login-hint">
                    <Link to="/login" state={{ from: { pathname: `/vacancies/${vacancy.id}` } }}>
                      Войдите
                    </Link>{' '}
                    или <Link to="/register">зарегистрируйтесь</Link>, чтобы переписываться с
                    работодателем на сайте. Написать в WhatsApp можно и без аккаунта.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        <div className={`secondary-actions${isOwner ? '' : ' single'}`}>
          <button type="button" onClick={handleShare}>
            🔗 {shareMsg || 'Поделиться'}
          </button>
          {isOwner && (
            <Link to={`/vacancies/${vacancy.id}/edit`} className="admin-btn-ghost secondary-link">
              ✏️ Изменить вакансию
            </Link>
          )}
        </div>

        {!vacancy.is_example && (
          <p className="hint">
            {vacancy.whatsapp_phone
              ? 'В WhatsApp можно написать без регистрации. Переписка на сайте — для тех, кто вошёл в аккаунт.'
              : 'Работодатель не указал WhatsApp — написать можно только через переписку на сайте, для этого нужен аккаунт.'}
          </p>
        )}
      </div>
    </div>
  );
}

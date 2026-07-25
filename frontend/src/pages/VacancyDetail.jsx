import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { relativeDate } from '../formatDate';
import { useAuth } from '../context/AuthContext';
import { employmentLabel } from '../employmentTypes';
import { formatSalary } from '../components/VacancyCard';
import FavoriteButton from '../components/FavoriteButton';

function waLink(phone, title) {
  const digits = phone.replace(/[^\d]/g, '');
  const text = encodeURIComponent(`Здравствуйте! Пишу по вакансии «${title}» на Шабашка.`);
  return `https://wa.me/${digits}?text=${text}`;
}

export default function VacancyDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [vacancy, setVacancy] = useState(null);
  const [error, setError] = useState('');
  const [shareMsg, setShareMsg] = useState('');

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

  if (error) return <p className="status-msg error">{error}</p>;
  if (!vacancy) return <p className="status-msg">Загрузка…</p>;

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
          <FavoriteButton type="vacancy" id={vacancy.id} className="order-detail-fav" />
        </div>
        <h1>{vacancy.title}</h1>
        <p className="meta">
          <span>💼 {employmentLabel(vacancy.employment_type)}</span>
          <span>{vacancy.work_format === 'online' ? '🌐 Онлайн' : '📍 Офлайн'}</span>
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

        <h3 className="desc-heading">Описание вакансии</h3>
        <p className="description">{vacancy.description}</p>

        {vacancy.status === 'closed' ? (
          <p className="status-msg">Эта вакансия уже закрыта.</p>
        ) : (
          <a
            className="whatsapp-btn"
            href={waLink(vacancy.whatsapp_phone, vacancy.title)}
            target="_blank"
            rel="noopener noreferrer"
          >
            💬 Написать в WhatsApp
          </a>
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

        <p className="hint">Отклик не требует регистрации — просто напишите работодателю напрямую.</p>
      </div>
    </div>
  );
}

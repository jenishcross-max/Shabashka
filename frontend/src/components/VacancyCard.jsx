import { Link } from 'react-router-dom';
import { relativeDate } from '../formatDate';
import { employmentLabel } from '../employmentTypes';
import { experienceLabel } from '../experienceLevels';
import FavoriteButton from './FavoriteButton';

export function formatSalary(min, max) {
  if (!min && !max) return 'По договорённости';
  if (min && max) return `${min.toLocaleString('ru-RU')}–${max.toLocaleString('ru-RU')} сом`;
  if (min) return `от ${min.toLocaleString('ru-RU')} сом`;
  return `до ${max.toLocaleString('ru-RU')} сом`;
}

export default function VacancyCard({ vacancy }) {
  return (
    <Link to={`/vacancies/${vacancy.id}`} className="order-card">
      <div className="order-card-top">
        <div className="order-card-badges">
          <span className="badge">{vacancy.category}</span>
          <span className="badge">{vacancy.work_format === 'online' ? '🌐 Онлайн' : '📍 Офлайн'}</span>
          {!!vacancy.pinned && <span className="badge pinned">🔥 Топ</span>}
        </div>
        <div className="order-card-top-right">
          <span className="order-city">{vacancy.city}</span>
          <FavoriteButton type="vacancy" id={vacancy.id} className="order-card-fav" />
        </div>
      </div>
      <h3>{vacancy.title}</h3>
      <p className="vacancy-employment">
        {employmentLabel(vacancy.employment_type)} · {experienceLabel(vacancy.experience)}
      </p>
      <p>{vacancy.description}</p>
      <div className="order-card-bottom">
        <span className="budget">{formatSalary(vacancy.salary_min, vacancy.salary_max)}</span>
        <span className="date">{relativeDate(vacancy.created_at)}</span>
      </div>
    </Link>
  );
}

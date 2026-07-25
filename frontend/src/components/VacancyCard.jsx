import { Link } from 'react-router-dom';
import { relativeDate } from '../formatDate';
import { imageUrl } from '../imageUrl';
import { employmentLabel } from '../employmentTypes';
import FavoriteButton from './FavoriteButton';

export function formatSalary(min, max) {
  if (!min && !max) return 'По договорённости';
  if (min && max) return `${min.toLocaleString('ru-RU')}–${max.toLocaleString('ru-RU')} сом`;
  if (min) return `от ${min.toLocaleString('ru-RU')} сом`;
  return `до ${max.toLocaleString('ru-RU')} сом`;
}

export default function VacancyCard({ vacancy }) {
  const photo = imageUrl(vacancy.image_path);

  return (
    <Link to={`/vacancies/${vacancy.id}`} className="order-card">
      {photo && <div className="order-card-photo" style={{ backgroundImage: `url(${photo})` }} />}
      <div className="order-card-top">
        <div className="order-card-badges">
          <span className="badge">{vacancy.category}</span>
          {!!vacancy.pinned && <span className="badge pinned">🔥 Топ</span>}
        </div>
        <span className="order-city">{vacancy.city}</span>
      </div>
      <h3>{vacancy.title}</h3>
      <p className="vacancy-employment">{employmentLabel(vacancy.employment_type)}</p>
      <p>{vacancy.description}</p>
      <div className="order-card-bottom">
        <span className="budget">{formatSalary(vacancy.salary_min, vacancy.salary_max)}</span>
        <span className="date">{relativeDate(vacancy.created_at)}</span>
      </div>
      <FavoriteButton type="vacancy" id={vacancy.id} className="order-card-fav" />
    </Link>
  );
}

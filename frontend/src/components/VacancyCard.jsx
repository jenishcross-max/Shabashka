import { relativeDate } from '../formatDate';
import { employmentLabel } from '../employmentTypes';
import { experienceLabel } from '../experienceLevels';
import ListingCard from './ListingCard';

export function formatSalary(min, max) {
  if (!min && !max) return 'По договорённости';
  if (min && max) return `${min.toLocaleString('ru-RU')}–${max.toLocaleString('ru-RU')} сом`;
  if (min) return `от ${min.toLocaleString('ru-RU')} сом`;
  return `до ${max.toLocaleString('ru-RU')} сом`;
}

// «Полная занятость, без опыта» — одна строка подробностей под заголовком.
function terms(vacancy) {
  const experience = experienceLabel(vacancy.experience);
  return [employmentLabel(vacancy.employment_type), experience && experience.charAt(0).toLowerCase() + experience.slice(1)]
    .filter(Boolean)
    .join(', ');
}

export default function VacancyCard({ vacancy }) {
  return (
    <ListingCard
      to={`/vacancies/${vacancy.id}`}
      badge={vacancy.category}
      city={vacancy.city}
      date={relativeDate(vacancy.created_at)}
      favorite={{ type: 'vacancy', id: vacancy.id }}
      title={vacancy.title}
      detail={terms(vacancy)}
      description={vacancy.description}
      price={formatSalary(vacancy.salary_min, vacancy.salary_max)}
      priceMuted={!vacancy.salary_min && !vacancy.salary_max}
      flags={{
        online: vacancy.work_format === 'online',
        students: !!vacancy.for_students,
        pinned: !!vacancy.pinned,
        example: !!vacancy.is_example,
        imported: !!vacancy.is_imported,
      }}
    />
  );
}

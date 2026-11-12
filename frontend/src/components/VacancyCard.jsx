import { relativeDate } from '../formatDate';
import { employmentLabel } from '../employmentTypes';
import { experienceLabel } from '../experienceLevels';
import ListingCard from './ListingCard';
import { formatSalary } from '../salary';

// Формат зарплаты живёт в salary.js (там же «в день» и отсев мусорных сумм);
// отсюда его по-прежнему берут карточки, админка и «Мои вакансии».
export { formatSalary };

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

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { orderWord, vacancyWord } from '../plural';
import OrderCard from './OrderCard';
import VacancyCard from './VacancyCard';

// «Для студентов» — пометка работодателя: работу можно совмещать с учёбой.
// Ставит её сам автор галочкой в форме или бот, если в объявлении прямо
// написано «можно студентам» (см. backend/src/students.js). По ней на сайте
// фильтр, на карточке значок, а в Instagram объявление выходит синим
// выпуском «Вакансии для студентов».

export function StudentBadge() {
  return <span className="badge badge-students">🎓 Студентам</span>;
}

// Фильтр над списком: отдельной плашкой, а не строкой среди категорий, —
// студент ищет не «Общепит», а работу, которую потянет вместе с учёбой.
export function StudentFilter({ checked, count, onChange }) {
  return (
    <label className={`student-filter${checked ? ' active' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="student-filter-icon" aria-hidden="true">
        🎓
      </span>
      <span className="student-filter-text">
        <strong>Для студентов</strong>
        <small>можно совмещать с учёбой</small>
      </span>
      <span className="filter-count">{count || 0}</span>
    </label>
  );
}

// Студент ищет не «подработку» или «вакансию», а работу, которую потянет
// вместе с учёбой. Разовые заказы из чатов почти никогда не пишут «можно
// студентам», и на «Подработке» фильтр стоял с нулём — люди писали нам, что
// работы для студентов нет, а в вакансиях их десятки. Поэтому с фильтром под
// своим списком выходит и соседний — отдельным блоком, со своим заголовком.
const OTHER = {
  vacancies: { load: (p) => api.vacancies(p), key: 'vacancies', title: 'Вакансии для студентов', word: vacancyWord },
  orders: { load: (p) => api.orders(p), key: 'orders', title: 'Подработки для студентов', word: orderWord },
};
const PREVIEW = 6;

export function StudentSection({ kind }) {
  const other = OTHER[kind];
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;
    other
      .load({ students: 1, limit: PREVIEW })
      .then((res) => alive && setData({ items: res[other.key] || [], total: res.total || 0 }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [other]);

  if (!data || !data.total) return null;
  return (
    <section className="student-section">
      <h2 className="student-section-head">
        🎓 {other.title} <span>{data.total}</span>
      </h2>
      <div className="order-grid orders-grid-2col">
        {data.items.map((item) =>
          kind === 'vacancies' ? <VacancyCard key={item.id} vacancy={item} /> : <OrderCard key={item.id} order={item} />
        )}
      </div>
      {data.total > data.items.length && (
        <Link className="student-section-all" to={`/${kind}?students=1`}>
          Все {data.total} {other.word(data.total)} для студентов →
        </Link>
      )}
    </section>
  );
}

// Галочка в форме вакансии или заказа.
export function StudentCheckbox({ checked, onChange, kind = 'vacancy' }) {
  return (
    <div className="field">
      <label className="filter-checkbox student-check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        🎓 Подходит студентам — можно совмещать с учёбой
      </label>
      <p className="format-hint">
        {kind === 'order' ? 'Заказ' : 'Вакансия'} попадёт в раздел «Для студентов» на сайте и выйдет в
        Instagram отдельным выпуском для студентов. Ставьте, только если и правда готовы взять студента.
      </p>
    </div>
  );
}

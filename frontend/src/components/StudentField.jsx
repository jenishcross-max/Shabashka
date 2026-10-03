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

import Sheet from './Sheet';
import { SkeletonFilterList } from './Skeleton';

// Фильтры списков «Подработка» и «Вакансии». На компьютере — колонкой слева от
// списка. На телефоне эта колонка стояла над списком: формат, двадцать шесть
// категорий, бюджет — первая карточка начиналась на третьем экране (1 700 px),
// и люди уходили, не долистав до объявлений. Там фильтры — в панели по кнопке
// «Фильтры», а список виден сразу.

export function FiltersButton({ active, onClick }) {
  return (
    <button type="button" className={`filters-button${active ? ' has-active' : ''}`} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M4 7h10M18 7h2M4 17h4M12 17h8M14 4.5v5M8 14.5v5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      Фильтры
      {active > 0 && <span className="filters-button-count">{active}</span>}
    </button>
  );
}

// phone — панель вместо колонки. total и word — для кнопки «Показать 154
// вакансии»: человек видит, сколько найдётся, ещё не закрыв панель.
export function FiltersPanel({ phone, open, onClose, onReset, active, total, word, children }) {
  if (!phone) return <aside className="orders-filters">{children}</aside>;
  return (
    <Sheet open={open} onClose={onClose} title="Фильтры">
      <div className="sheet-filters">{children}</div>
      <div className="sheet-filters-actions">
        {active > 0 && (
          <button type="button" className="sheet-filters-reset" onClick={onReset}>
            Сбросить
          </button>
        )}
        <button type="button" className="sheet-filters-show" onClick={onClose}>
          {total > 0 ? `Показать ${total} ${word(total)}` : 'Готово'}
        </button>
      </div>
    </Sheet>
  );
}

// Категории — по убыванию числа объявлений и без пустых: на «Вакансиях»
// «Общепит» (793) стоял восемнадцатым, ниже «Психологии» (1), а на «Подработке»
// висели «Охрана 0», «Офис 0». Выбранную оставляем, даже если в ней стало пусто,
// — иначе её не снять. counts — null, пока не пришли.
export function CategoryFilter({ categories, counts, selected, onToggle }) {
  if (!categories.length || !counts) {
    return (
      <div className="admin-card">
        <h3 className="filter-heading">Категория</h3>
        <SkeletonFilterList rows={7} />
      </div>
    );
  }
  const shown = categories
    .filter((c) => counts[c] > 0 || selected.includes(c))
    .sort((a, b) => (counts[b] || 0) - (counts[a] || 0));
  if (!shown.length) return null;
  return (
    <div className="admin-card">
      <h3 className="filter-heading">Категория</h3>
      <div className="filter-checkbox-list">
        {shown.map((c) => (
          <label key={c} className="filter-checkbox">
            <input type="checkbox" checked={selected.includes(c)} onChange={() => onToggle(c)} />
            {c}
            <span className="filter-count">{counts[c] || 0}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

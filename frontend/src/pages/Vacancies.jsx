import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import VacancyCard from '../components/VacancyCard';
import CityAutocomplete from '../components/CityAutocomplete';
import { useCities } from '../useCities';
import { pageList } from '../pagination';
import { SkeletonBox, SkeletonOrderCard, SkeletonFilterList } from '../components/Skeleton';

const SORTS = [
  { value: 'new', label: 'Сначала новые' },
  { value: 'salaryDesc', label: 'Зарплата: больше' },
  { value: 'salaryAsc', label: 'Зарплата: меньше' },
];

export default function Vacancies() {
  const cities = useCities();
  const [searchParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [counts, setCounts] = useState({});
  const [employmentTypes, setEmploymentTypes] = useState([]);
  const [vacancies, setVacancies] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [employmentType, setEmploymentType] = useState('');
  const [sort, setSort] = useState('new');
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.categories().then(({ categories }) => setCategories(categories));
    api.vacancyCategoryCounts().then(({ counts }) => setCounts(counts));
    api.employmentTypes().then(({ employmentTypes }) => setEmploymentTypes(employmentTypes));
  }, []);

  // Категория/город/поиск приходят через query-параметры — так работают
  // ссылки с главной и из навбара.
  useEffect(() => {
    const cat = searchParams.get('category');
    setSelectedCategories(cat ? [cat] : []);
    setCity(searchParams.get('city') || '');
    setQ(searchParams.get('q') || '');
    const et = searchParams.get('employmentType');
    if (et) setEmploymentType(et);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('category'), searchParams.get('city'), searchParams.get('q'), searchParams.get('employmentType')]);

  useEffect(() => {
    setLoading(true);
    setError('');
    const handle = setTimeout(() => {
      api
        .vacancies({
          q,
          city,
          category: selectedCategories,
          employmentType,
          sort,
          page,
          limit: 8,
        })
        .then(({ vacancies, ...m }) => {
          setVacancies(vacancies);
          setMeta(m);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [q, city, selectedCategories, employmentType, sort, page]);

  function toggleCategory(c) {
    setPage(1);
    setSelectedCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function goToPage(p) {
    document.activeElement?.blur();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setPage(p);
  }

  return (
    <div>
      <section className="orders-search-strip">
        <input
          placeholder="Поиск по вакансиям…"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
        <CityAutocomplete
          placeholder="Город"
          cities={cities}
          value={city}
          onChange={(v) => {
            setPage(1);
            setCity(v);
          }}
        />
        <button type="button" onClick={() => setPage(1)}>
          Найти
        </button>
      </section>

      <div className="orders-layout">
        <aside className="orders-filters">
          <div className="admin-card">
            <h3 className="filter-heading">Категория</h3>
            {categories.length === 0 && <SkeletonFilterList rows={7} />}
            <div className="filter-checkbox-list">
              {categories.map((c) => (
                <label key={c} className="filter-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedCategories.includes(c)}
                    onChange={() => toggleCategory(c)}
                  />
                  {c}
                  <span className="filter-count">{counts[c] || 0}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="admin-card">
            <h3 className="filter-heading">Занятость</h3>
            <div className="filter-checkbox-list">
              <label className="filter-checkbox">
                <input
                  type="radio"
                  name="employment"
                  checked={employmentType === ''}
                  onChange={() => {
                    setPage(1);
                    setEmploymentType('');
                  }}
                />
                Любая
              </label>
              {employmentTypes.map((t) => (
                <label key={t.value} className="filter-checkbox">
                  <input
                    type="radio"
                    name="employment"
                    checked={employmentType === t.value}
                    onChange={() => {
                      setPage(1);
                      setEmploymentType(t.value);
                    }}
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </div>
        </aside>

        <div>
          <div className="orders-results-head">
            <span>
              {loading ? (
                <SkeletonBox width={90} height={14} />
              ) : (
                <>
                  <strong>{meta.total}</strong> {meta.total === 1 ? 'вакансия' : 'вакансий'}
                </>
              )}
            </span>
            <select className="sort-select" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="status-msg error">{error}</p>}
          {!loading && !error && vacancies.length === 0 && (
            <p className="status-msg">Пока нет вакансий по этим фильтрам.</p>
          )}

          <div className="order-grid orders-grid-2col">
            {loading && Array.from({ length: 8 }).map((_, i) => <SkeletonOrderCard key={i} />)}
            {!loading && vacancies.map((v) => <VacancyCard key={v.id} vacancy={v} />)}
          </div>

          {meta.pages > 1 && (
            <div className="pagination">
              <button disabled={page <= 1} onClick={() => goToPage(Math.max(1, page - 1))}>
                ←
              </button>
              {pageList(page, meta.pages).map((p, i) =>
                p === '…' ? (
                  <span key={`e${i}`} className="pagination-ellipsis">
                    …
                  </span>
                ) : (
                  <button key={p} className={p === page ? 'active' : ''} onClick={() => goToPage(p)}>
                    {p}
                  </button>
                )
              )}
              <button
                disabled={page >= meta.pages}
                onClick={() => goToPage(Math.min(meta.pages, page + 1))}
              >
                →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

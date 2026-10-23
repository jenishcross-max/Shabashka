import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import VacancyCard from '../components/VacancyCard';
import CityAutocomplete from '../components/CityAutocomplete';
import { useCities } from '../useCities';
import { pageList } from '../pagination';
import { SkeletonBox, SkeletonOrderCard } from '../components/Skeleton';
import { useMeta } from '../useMeta';
import { orderWord, vacancyWord } from '../plural';
import { StudentFilter } from '../components/StudentField';
import CrossResults from '../components/CrossResults';
import { CategoryFilter, FiltersButton, FiltersPanel } from '../components/ListFilters';
import WorkSwitcher from '../components/WorkSwitcher';
import SubscribeButton from '../components/SubscribeButton';
import { PHONE, useMediaQuery } from '../useMediaQuery';

const SORTS = [
  { value: 'new', label: 'Сначала новые' },
  { value: 'salaryDesc', label: 'Зарплата: больше' },
  { value: 'salaryAsc', label: 'Зарплата: меньше' },
];

export default function Vacancies() {
  useMeta(
    'Все вакансии — Шабашка',
    'Список актуальных вакансий и подработки в Кыргызстане: фильтры по городу, категории и зарплате.'
  );
  const cities = useCities();
  const phone = useMediaQuery(PHONE);
  const [searchParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [counts, setCounts] = useState(null);
  const [employmentTypes, setEmploymentTypes] = useState([]);
  const [vacancies, setVacancies] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [employmentType, setEmploymentType] = useState('');
  const [students, setStudents] = useState(false);
  const [studentCount, setStudentCount] = useState(0);
  // Число у фильтра — вместе с подработками: с ним выходят и они (CrossResults).
  const [studentOrders, setStudentOrders] = useState(0);
  // Сколько нашлось в подработке по тому же поиску — для строки над пустым списком.
  const [crossTotal, setCrossTotal] = useState(null);
  const [sort, setSort] = useState('new');
  const [page, setPage] = useState(1);

  useEffect(() => {
    api.categories().then(({ categories }) => setCategories(categories));
    api
      .categoryCounts()
      .then(({ students }) => setStudentOrders(students || 0))
      .catch(() => {});
    api.employmentTypes().then(({ employmentTypes }) => setEmploymentTypes(employmentTypes));
  }, []);

  // С «Для студентов» числа у категорий — тоже только студенческие.
  useEffect(() => {
    api.vacancyCategoryCounts(students).then(({ counts, students: n }) => {
      setCounts(counts);
      setStudentCount(n || 0);
    });
  }, [students]);

  // Категория/город/поиск приходят через query-параметры — так работают
  // ссылки с главной и из навбара.
  useEffect(() => {
    const cat = searchParams.get('category');
    setSelectedCategories(cat ? [cat] : []);
    setCity(searchParams.get('city') || '');
    setQ(searchParams.get('q') || '');
    const et = searchParams.get('employmentType');
    if (et) setEmploymentType(et);
    // «Работа для студентов» с главной ведёт сюда с ?students=1.
    setStudents(searchParams.get('students') === '1');
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchParams.get('category'),
    searchParams.get('city'),
    searchParams.get('q'),
    searchParams.get('employmentType'),
    searchParams.get('students'),
  ]);

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
          students: students ? 1 : '',
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
  }, [q, city, selectedCategories, employmentType, students, sort, page]);

  function toggleCategory(c) {
    setPage(1);
    setSelectedCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function goToPage(p) {
    document.activeElement?.blur();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setPage(p);
  }

  const activeFilters = selectedCategories.length + (employmentType ? 1 : 0);
  function resetFilters() {
    setPage(1);
    setSelectedCategories([]);
    setEmploymentType('');
  }

  const query = q.trim();
  function emptyText() {
    if (!query && !students) return 'Пока нет вакансий по этим фильтрам.';
    const what = `Вакансий${students ? ' для студентов' : ''}${query ? ` по запросу «${query}»` : ''} сейчас нет`;
    if (crossTotal > 0) return `${what} — зато есть ${crossTotal} ${orderWord(crossTotal)} на подработку:`;
    if (crossTotal === 0) return `${what}. Попробуйте другое слово или уберите фильтры.`;
    return `${what}.`;
  }

  const studentFilter = (
    <StudentFilter
      checked={students}
      count={studentCount + studentOrders}
      onChange={(v) => {
        setPage(1);
        setStudents(v);
      }}
    />
  );

  return (
    <div>
      <WorkSwitcher />
      <section className="orders-search-strip">
        <input
          type="search"
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
        {phone ? (
          <FiltersButton active={activeFilters} onClick={() => setFiltersOpen(true)} />
        ) : (
          <button type="button" onClick={() => setPage(1)}>
            Найти
          </button>
        )}
      </section>
      {phone && studentFilter}

      <div className="orders-layout">
        <FiltersPanel
          phone={phone}
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          onReset={resetFilters}
          active={activeFilters}
          total={meta.total}
          word={vacancyWord}
        >
          {!phone && studentFilter}
          <CategoryFilter
            categories={categories}
            counts={counts}
            selected={selectedCategories}
            onToggle={toggleCategory}
          />
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
        </FiltersPanel>

        <div>
          {/* «0 вакансий» крупно наверху читался как «работы нет» — при пустом
              списке вместо него строка ниже, с подсказкой, где искать. */}
          {(loading || meta.total > 0) && (
            <div className="orders-results-head">
              <span>
                {loading ? (
                  <SkeletonBox width={90} height={14} />
                ) : (
                  <>
                    <strong>{meta.total}</strong> {vacancyWord(meta.total)}
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
          )}

          {/* Сюда ведёт «Все N вакансий за сутки» из постов Threads — пусть
              новые приходят сами. Выбрана одна профессия — подписка на неё. */}
          <div className="list-subscribe">
            <SubscribeButton category={selectedCategories.length === 1 ? selectedCategories[0] : null} />
          </div>

          {error && <p className="status-msg error">{error}</p>}
          {!loading && !error && vacancies.length === 0 && <p className="status-msg">{emptyText()}</p>}

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

          <CrossResults
            kind="orders"
            q={q}
            city={city}
            students={students}
            alone={!loading && !error && vacancies.length === 0}
            onTotal={setCrossTotal}
          />
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import OrderCard from '../components/OrderCard';
import FormatIcon from '../components/FormatIcon';
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
import { PHONE, useMediaQuery } from '../useMediaQuery';

const SORTS = [
  { value: 'new', label: 'Сначала новые' },
  { value: 'priceDesc', label: 'Дороже' },
  { value: 'priceAsc', label: 'Дешевле' },
];

export default function AllOrders() {
  useMeta(
    'Все заказы — Шабашка',
    'Список всех актуальных заказов на подработку в Кыргызстане: фильтры по городу, категории и бюджету.'
  );
  const cities = useCities();
  const phone = useMediaQuery(PHONE);
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [counts, setCounts] = useState(null);
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [hasBudget, setHasBudget] = useState(false);
  const [workFormat, setWorkFormatState] = useState('');
  const [students, setStudents] = useState(false);
  const [studentCount, setStudentCount] = useState(0);
  // Рядом с фильтром — сколько всего для студентов: с ним выходят и вакансии
  // (см. CrossResults), а ноль у одних подработок читали как «работы нет».
  const [studentVacancies, setStudentVacancies] = useState(0);
  // Сколько нашлось в вакансиях по тому же поиску — для строки над пустым списком.
  const [crossTotal, setCrossTotal] = useState(null);
  const [sort, setSort] = useState('new');
  const [page, setPage] = useState(1);

  // Формат работы задаётся через query-параметр — так на него можно ссылаться
  // из меню в навбаре («Онлайн» / «Офлайн»), а не только через фильтр на странице.
  useEffect(() => {
    const wf = searchParams.get('workFormat');
    setWorkFormatState(wf === 'online' || wf === 'offline' ? wf : '');
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('workFormat')]);

  // Категория/город/поиск тоже приходят через query-параметры — так работают
  // ссылки с главной («Категории», «Заказы по городам»).
  useEffect(() => {
    const cat = searchParams.get('category');
    setSelectedCategories(cat ? [cat] : []);
    setCity(searchParams.get('city') || '');
    setQ(searchParams.get('q') || '');
    setStudents(searchParams.get('students') === '1');
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('category'), searchParams.get('city'), searchParams.get('q'), searchParams.get('students')]);

  // Остальные параметры адреса не трогаем: раньше выбор формата стирал их все,
  // и вместе с ним слетали поиск и «Для студентов».
  function setWorkFormat(value) {
    setPage(1);
    setWorkFormatState(value);
    const next = new URLSearchParams(searchParams);
    if (value) next.set('workFormat', value);
    else next.delete('workFormat');
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    api.categories().then(({ categories }) => setCategories(categories));
    api
      .vacancyCategoryCounts()
      .then(({ students }) => setStudentVacancies(students || 0))
      .catch(() => {});
  }, []);

  // С «Для студентов» числа у категорий — тоже только студенческие.
  useEffect(() => {
    api.categoryCounts(students).then(({ counts, students: n }) => {
      setCounts(counts);
      setStudentCount(n || 0);
    });
  }, [students]);

  useEffect(() => {
    setLoading(true);
    setError('');
    const handle = setTimeout(() => {
      api
        .orders({
          q,
          city,
          category: selectedCategories,
          budgetMin,
          budgetMax,
          hasBudget,
          workFormat,
          students: students ? 1 : '',
          sort,
          page,
          limit: 8,
        })
        .then(({ orders, ...m }) => {
          setOrders(orders);
          setMeta(m);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [q, city, selectedCategories, budgetMin, budgetMax, hasBudget, workFormat, students, sort, page]);

  function toggleCategory(c) {
    setPage(1);
    setSelectedCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function goToPage(p) {
    document.activeElement?.blur();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setPage(p);
  }

  const activeFilters =
    selectedCategories.length + (workFormat ? 1 : 0) + (budgetMin || budgetMax ? 1 : 0) + (hasBudget ? 1 : 0);
  function resetFilters() {
    setPage(1);
    setSelectedCategories([]);
    setBudgetMin('');
    setBudgetMax('');
    setHasBudget(false);
    setWorkFormat('');
  }

  const query = q.trim();
  function emptyText() {
    if (!query && !students) return 'Пока нет заказов по этим фильтрам.';
    const what = `Подработок${students ? ' для студентов' : ''}${query ? ` по запросу «${query}»` : ''} сейчас нет`;
    if (crossTotal > 0) return `${what} — зато есть ${crossTotal} ${vacancyWord(crossTotal)}:`;
    if (crossTotal === 0) return `${what}. Попробуйте другое слово или уберите фильтры.`;
    return `${what}.`;
  }

  const studentFilter = (
    <StudentFilter
      checked={students}
      count={studentCount + studentVacancies}
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
          placeholder="Поиск по заказам…"
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
          word={orderWord}
        >
          {!phone && studentFilter}
          <div className="admin-card">
            <h3 className="filter-heading">Формат работы</h3>
            <div className="format-toggle">
              <label className={`format-option${workFormat === '' ? ' active' : ''}`}>
                <input type="radio" name="workFormat" checked={workFormat === ''} onChange={() => setWorkFormat('')} />
                <FormatIcon name="all" />
                Все
              </label>
              <label className={`format-option${workFormat === 'offline' ? ' active' : ''}`}>
                <input
                  type="radio"
                  name="workFormat"
                  checked={workFormat === 'offline'}
                  onChange={() => setWorkFormat('offline')}
                />
                <FormatIcon name="offline" />
                Офлайн
              </label>
              <label className={`format-option${workFormat === 'online' ? ' active' : ''}`}>
                <input
                  type="radio"
                  name="workFormat"
                  checked={workFormat === 'online'}
                  onChange={() => setWorkFormat('online')}
                />
                <FormatIcon name="online" />
                Онлайн
              </label>
            </div>
          </div>
          <CategoryFilter
            categories={categories}
            counts={counts}
            selected={selectedCategories}
            onToggle={toggleCategory}
          />
          <div className="admin-card">
            <h3 className="filter-heading">Бюджет, сом</h3>
            <div className="filter-budget-row">
              <input
                placeholder="от"
                type="number"
                min="0"
                value={budgetMin}
                onChange={(e) => {
                  setPage(1);
                  setBudgetMin(e.target.value);
                }}
              />
              <input
                placeholder="до"
                type="number"
                min="0"
                value={budgetMax}
                onChange={(e) => {
                  setPage(1);
                  setBudgetMax(e.target.value);
                }}
              />
            </div>
            <label className="filter-checkbox">
              <input
                type="checkbox"
                checked={hasBudget}
                onChange={(e) => {
                  setPage(1);
                  setHasBudget(e.target.checked);
                }}
              />
              Только с бюджетом
            </label>
          </div>
        </FiltersPanel>

        <div>
          {/* «0 заказов» крупно наверху читался как «работы нет» — при пустом
              списке вместо него строка ниже, с подсказкой, где искать. */}
          {(loading || meta.total > 0) && (
            <div className="orders-results-head">
              <span>
                {loading ? (
                  <SkeletonBox width={90} height={14} />
                ) : (
                  <>
                    <strong>{meta.total}</strong> {orderWord(meta.total)}
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

          {error && <p className="status-msg error">{error}</p>}
          {!loading && !error && orders.length === 0 && <p className="status-msg">{emptyText()}</p>}

          <div className="order-grid orders-grid-2col">
            {loading && Array.from({ length: 8 }).map((_, i) => <SkeletonOrderCard key={i} />)}
            {!loading && orders.map((order) => <OrderCard key={order.id} order={order} />)}
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
              <button disabled={page >= meta.pages} onClick={() => goToPage(Math.min(meta.pages, page + 1))}>
                →
              </button>
            </div>
          )}

          <CrossResults
            kind="vacancies"
            q={q}
            city={city}
            students={students}
            alone={!loading && !error && orders.length === 0}
            onTotal={setCrossTotal}
          />
        </div>
      </div>
    </div>
  );
}

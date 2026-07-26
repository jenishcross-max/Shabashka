import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import OrderCard from '../components/OrderCard';
import FormatIcon from '../components/FormatIcon';
import CityAutocomplete from '../components/CityAutocomplete';
import { useCities } from '../useCities';
import { pageList } from '../pagination';
import { SkeletonBox, SkeletonOrderCard, SkeletonFilterList } from '../components/Skeleton';

const SORTS = [
  { value: 'new', label: 'Сначала новые' },
  { value: 'priceDesc', label: 'Дороже' },
  { value: 'priceAsc', label: 'Дешевле' },
];

export default function AllOrders() {
  const cities = useCities();
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [counts, setCounts] = useState({});
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [hasBudget, setHasBudget] = useState(false);
  const [workFormat, setWorkFormatState] = useState('');
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
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('category'), searchParams.get('city'), searchParams.get('q')]);

  function setWorkFormat(value) {
    setPage(1);
    setWorkFormatState(value);
    setSearchParams(value ? { workFormat: value } : {}, { replace: true });
  }

  useEffect(() => {
    api.categories().then(({ categories }) => setCategories(categories));
    api.categoryCounts().then(({ counts }) => setCounts(counts));
  }, []);

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
  }, [q, city, selectedCategories, budgetMin, budgetMax, hasBudget, workFormat, sort, page]);

  function toggleCategory(c) {
    setPage(1);
    setSelectedCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  return (
    <div>
      <section className="orders-search-strip">
        <input
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
        <button type="button" onClick={() => setPage(1)}>
          Найти
        </button>
      </section>

      <div className="orders-layout">
        <aside className="orders-filters">
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
        </aside>

        <div>
          <div className="orders-results-head">
            <span>
              {loading ? (
                <SkeletonBox width={90} height={14} />
              ) : (
                <>
                  <strong>{meta.total}</strong> {meta.total === 1 ? 'заказ' : 'заказа'}
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
          {!loading && !error && orders.length === 0 && (
            <p className="status-msg">Пока нет заказов по этим фильтрам.</p>
          )}

          <div className="order-grid orders-grid-2col">
            {loading && Array.from({ length: 8 }).map((_, i) => <SkeletonOrderCard key={i} />)}
            {!loading &&
              orders.map((order) => <OrderCard key={order.id} order={order} />)}
          </div>

          {meta.pages > 1 && (
            <div className="pagination">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                ←
              </button>
              {pageList(page, meta.pages).map((p, i) =>
                p === '…' ? (
                  <span key={`e${i}`} className="pagination-ellipsis">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    className={p === page ? 'active' : ''}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                )
              )}
              <button disabled={page >= meta.pages} onClick={() => setPage((p) => Math.min(meta.pages, p + 1))}>
                →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

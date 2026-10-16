import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useCities } from '../useCities';
import { useMeta } from '../useMeta';
import { pageList } from '../pagination';
import { adWord } from '../plural';
import { CATEGORIES, KINDS } from '../ads';
import AdCard from '../components/AdCard';
import CityAutocomplete from '../components/CityAutocomplete';
import { SkeletonBox } from '../components/Skeleton';

const SORTS = [
  ['new', 'Сначала новые'],
  ['cheap', 'Сначала дешевле'],
  ['expensive', 'Сначала дороже'],
];

// Все фильтры, которые живут в адресе: ссылку на «сдам · отдых · Чолпон-Ата»
// можно переслать, а «назад» возвращает к той же подборке.
const FILTER_KEYS = ['kind', 'category', 'city', 'q', 'priceMin', 'priceMax', 'sort'];

export default function Ads() {
  useMeta(
    'Объявления — Шабашка',
    'Сдам, сниму, продам, куплю, отдам даром: жильё, пансионаты, транспорт, техника и вещи по всему Кыргызстану.'
  );
  const { user } = useAuth();
  const cities = useCities();
  const [searchParams, setSearchParams] = useSearchParams();
  const [ads, setAds] = useState([]);
  const [meta, setMeta] = useState({ total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, searchParams.get(k) || '']));
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const { kind, category, city, q, priceMin, priceMax, sort } = filters;

  const [inputs, setInputs] = useState({ q, city, priceMin, priceMax });

  // Адрес мог смениться не из формы (пункт меню сбрасывает фильтры) — поля
  // должны показывать то, по чему лента реально отфильтрована.
  useEffect(() => {
    setInputs({ q, city, priceMin, priceMax });
  }, [q, city, priceMin, priceMax]);

  // Ответ на прежние фильтры может прийти позже нового — его просто не берём.
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    api
      .ads({ kind, category, city, q, priceMin, priceMax, sort, page })
      .then((data) => {
        if (!current) return;
        setAds(data.ads);
        setMeta({ total: data.total, pages: data.pages });
      })
      .catch((e) => current && setError(e.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [kind, category, city, q, priceMin, priceMax, sort, page]);

  function applyFilters(next) {
    const params = new URLSearchParams();
    const merged = { ...filters, ...next };
    for (const key of FILTER_KEYS) {
      if (merged[key] && !(key === 'sort' && merged[key] === 'new')) params.set(key, merged[key]);
    }
    if (next.page > 1) params.set('page', next.page);
    setSearchParams(params);
  }

  function submit(e) {
    e.preventDefault();
    applyFilters({
      q: inputs.q.trim(),
      city: inputs.city.trim(),
      priceMin: inputs.priceMin.trim(),
      priceMax: inputs.priceMax.trim(),
    });
  }

  const setInput = (key) => (e) => setInputs((f) => ({ ...f, [key]: e.target.value }));
  const anyFilter = FILTER_KEYS.some((k) => k !== 'sort' && filters[k]);

  return (
    <div>
      <div className="tasks-head">
        <div>
          <h1>Объявления</h1>
          <p className="tasks-lead">Сдам, сниму, продам, куплю или отдам даром — по всему Кыргызстану.</p>
        </div>
        <div className="tasks-head-actions">
          {user && (
            <Link to="/my-ads" className="admin-btn-ghost">
              Мои объявления
            </Link>
          )}
          <Link to="/ads/new" className="cta">
            + Подать объявление
          </Link>
        </div>
      </div>

      <div className="ads-kinds" role="group" aria-label="Что ищете">
        <button type="button" className={kind ? '' : 'active'} onClick={() => applyFilters({ kind: '' })}>
          Все
        </button>
        {KINDS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={kind === value ? 'active' : ''}
            onClick={() => applyFilters({ kind: value })}
          >
            {label}
          </button>
        ))}
      </div>

      <form className="tasks-filters ads-filters" onSubmit={submit}>
        <input placeholder="Что ищете? Например: квартира" value={inputs.q} onChange={setInput('q')} />
        <CityAutocomplete
          placeholder="Город"
          cities={cities}
          value={inputs.city}
          onChange={(v) => setInputs((f) => ({ ...f, city: v }))}
        />
        <select value={category} onChange={(e) => applyFilters({ category: e.target.value })}>
          <option value="">Все рубрики</option>
          {CATEGORIES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="ads-price-range">
          <input inputMode="numeric" placeholder="Цена от" value={inputs.priceMin} onChange={setInput('priceMin')} />
          <input inputMode="numeric" placeholder="до" value={inputs.priceMax} onChange={setInput('priceMax')} />
        </div>
        <button type="submit">Найти</button>
      </form>

      <div className="orders-results-head">
        <span>
          {loading ? (
            <SkeletonBox width={90} height={14} />
          ) : (
            <>
              <strong>{meta.total}</strong> {adWord(meta.total)}
            </>
          )}
        </span>
        <select
          className="ads-sort"
          value={sort || 'new'}
          onChange={(e) => applyFilters({ sort: e.target.value })}
          aria-label="Сортировка"
        >
          {SORTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="status-msg error">{error}</p>}
      {!loading && !error && ads.length === 0 && (
        <p className="status-msg">
          {anyFilter
            ? 'По этим фильтрам объявлений нет.'
            : 'Пока нет объявлений. Подайте первое — его увидят все, кто заходит в раздел.'}
        </p>
      )}

      <div className="ad-grid">
        {loading && Array.from({ length: 8 }).map((_, i) => <div key={i} className="ad-card skeleton-ad" />)}
        {!loading && ads.map((ad) => <AdCard key={ad.id} ad={ad} />)}
      </div>

      {meta.pages > 1 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => applyFilters({ page: page - 1 })}>
            ←
          </button>
          {pageList(page, meta.pages).map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} className="pagination-ellipsis">
                …
              </span>
            ) : (
              <button key={p} className={p === page ? 'active' : ''} onClick={() => applyFilters({ page: p })}>
                {p}
              </button>
            )
          )}
          <button disabled={page >= meta.pages} onClick={() => applyFilters({ page: page + 1 })}>
            →
          </button>
        </div>
      )}
    </div>
  );
}

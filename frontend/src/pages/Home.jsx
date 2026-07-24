import { useEffect, useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { api } from '../api';
import OrderCard from '../components/OrderCard';
import { categoryIcon } from '../categoryIcons';
import { useFavorites } from '../context/FavoritesContext';

const SORTS = [
  { value: 'new', label: 'Сначала новые' },
  { value: 'budget', label: 'По бюджету' },
  { value: 'popular', label: 'Популярные' },
];

export default function Home() {
  const location = useLocation();
  const { ids: favoriteIds } = useFavorites();
  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState({ total: 0, page: 1, pages: 1 });
  const [categories, setCategories] = useState([]);
  const [counts, setCounts] = useState({});
  const [filters, setFilters] = useState({ category: '', city: '', q: '', sort: 'new' });
  const [qInput, setQInput] = useState('');
  const [cityInput, setCityInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.categories().then(({ categories }) => setCategories(categories));
    api.categoryCounts().then(({ counts }) => setCounts(counts));
  }, []);

  useEffect(() => {
    if (location.hash === '#how') {
      document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [location.hash]);

  useEffect(() => {
    setLoading(true);
    setError('');
    const handle = setTimeout(() => {
      api
        .orders({ ...filters, page: 1 })
        .then(({ orders, ...m }) => {
          setOrders(orders);
          setMeta(m);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [filters]);

  function submitSearch(e) {
    e.preventDefault();
    setFilters((f) => ({ ...f, q: qInput, city: cityInput }));
  }

  function toggleCategory(category) {
    setFilters((f) => ({ ...f, category: f.category === category ? '' : category }));
  }

  function loadMore() {
    setLoadingMore(true);
    api
      .orders({ ...filters, page: meta.page + 1 })
      .then(({ orders: more, ...m }) => {
        setOrders((prev) => [...prev, ...more]);
        setMeta(m);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingMore(false));
  }

  const hasFilters = filters.category || filters.city || filters.q;

  return (
    <div>
      <section className="hero">
        <span className="hero-pill">Работает по всему Кыргызстану</span>
        <h1>Найдите подработку или мастера рядом с вами</h1>
        <p>
          Заказчики размещают задачи, исполнители пишут напрямую в WhatsApp. Никакой регистрации,
          чтобы откликнуться.
        </p>
        <form className="search-bar" onSubmit={submitSearch}>
          <input
            className="search-q"
            placeholder="Что нужно сделать? Например: убрать квартиру"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
          <div className="search-divider" />
          <input
            className="search-city"
            placeholder="Город"
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
          />
          <button type="submit">Найти</button>
        </form>
        {favoriteIds.length > 0 && (
          <Link to="/favorites" className="hero-fav-link">
            ★ Избранное ({favoriteIds.length})
          </Link>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Категории</h2>
        </div>
        <div className="category-grid">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              className={`category-tile${filters.category === c ? ' active' : ''}`}
              onClick={() => toggleCategory(c)}
            >
              <span className="category-icon">{categoryIcon(c)}</span>
              <span>
                <span className="category-name">{c}</span>
                <span className="category-count">{counts[c] || 0} заказов</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>
            Свежие заказы{meta.total > 0 && <span className="section-count"> · {meta.total}</span>}
          </h2>
          <div className="feed-controls">
            {hasFilters && (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setFilters({ category: '', city: '', q: '', sort: filters.sort });
                  setQInput('');
                  setCityInput('');
                }}
              >
                Сбросить фильтры →
              </a>
            )}
            <select
              value={filters.sort}
              onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}
              className="sort-select"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading && <p className="status-msg">Загрузка заказов…</p>}
        {error && <p className="status-msg error">{error}</p>}
        {!loading && !error && orders.length === 0 && (
          <p className="status-msg">Пока нет заказов по этим фильтрам.</p>
        )}

        <div className="order-grid">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>

        {!loading && meta.page < meta.pages && (
          <div className="load-more">
            <button className="admin-btn-ghost" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Загружаем…' : 'Показать ещё'}
            </button>
          </div>
        )}
      </section>

      <section className="how-it-works" id="how">
        <h2>Как это работает</h2>
        <div className="how-grid">
          <div className="how-step">
            <div className="how-step-num">1</div>
            <h3>Разместите заказ</h3>
            <p>Опишите задачу, укажите город и бюджет. Займёт пару минут.</p>
          </div>
          <div className="how-step">
            <div className="how-step-num">2</div>
            <h3>Исполнитель находит вас</h3>
            <p>Мастера видят заказ и сами пишут вам в WhatsApp. Регистрация не нужна.</p>
          </div>
          <div className="how-step">
            <div className="how-step-num">3</div>
            <h3>Договариваетесь</h3>
            <p>Обсуждаете цену и сроки напрямую. Сайт не берёт комиссию.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

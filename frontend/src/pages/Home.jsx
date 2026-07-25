import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { api } from '../api';
import OrderCard from '../components/OrderCard';
import VacancyCard from '../components/VacancyCard';
import { categoryIcon } from '../categoryIcons';
import { useFavorites } from '../context/FavoritesContext';

export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const { keys: favoriteKeys } = useFavorites();
  const [cities, setCities] = useState([]);
  const [orders, setOrders] = useState([]);
  const [vacancies, setVacancies] = useState([]);
  const [categories, setCategories] = useState([]);
  const [counts, setCounts] = useState({});
  const [cityCounts, setCityCounts] = useState([]);
  const [stats, setStats] = useState(null);
  const [qInput, setQInput] = useState('');
  const [cityInput, setCityInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Всё содержимое главной приходит одним запросом: база далеко, и семь
  // параллельных запросов заметно задерживали первую отрисовку.
  useEffect(() => {
    api
      .home()
      .then((data) => {
        setCategories(data.categories);
        setCounts(data.counts);
        setCityCounts(data.cityCounts);
        setStats(data.stats);
        setOrders(data.orders);
        setVacancies(data.vacancies);
        setCities(data.cities);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (location.hash === '#how') {
      document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [location.hash]);

  function submitSearch(e) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (qInput) params.set('q', qInput);
    if (cityInput) params.set('city', cityInput);
    navigate(`/orders${params.toString() ? `?${params}` : ''}`);
  }

  return (
    <div>
      <section className="hero">
        <span className="hero-pill">Работает по всему Кыргызстану</span>
        <h1>Шабашка в Кыргызстане</h1>
        <p>
          Найдите подработку или мастера рядом с вами. Заказчики размещают задачи, исполнители
          пишут напрямую в WhatsApp. Никакой регистрации, чтобы откликнуться.
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
            list="cities-list"
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
          />
          <button type="submit">Найти</button>
        </form>
        <datalist id="cities-list">
          {cities.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="hero-format-links">
          <span className="hero-format-label">Смотреть подработку:</span>
          <Link to="/orders">Всю</Link>
          <Link to="/orders?workFormat=offline">📍 Только офлайн</Link>
          <Link to="/orders?workFormat=online">🌐 Только онлайн</Link>
        </div>
        {favoriteKeys.length > 0 && (
          <Link to="/favorites" className="hero-fav-link">
            ★ Избранное ({favoriteKeys.length})
          </Link>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Категории</h2>
        </div>
        <div className="category-grid">
          {categories.map((c) => (
            <Link key={c} to={`/orders?category=${encodeURIComponent(c)}`} className="category-tile">
              <span className="category-icon">{categoryIcon(c)}</span>
              <span>
                <span className="category-name">{c}</span>
                <span className="category-count">{counts[c] || 0} заказов</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Свежие заказы</h2>
          <Link to="/orders">Смотреть все →</Link>
        </div>

        {loading && <p className="status-msg">Загрузка заказов…</p>}
        {error && <p className="status-msg error">{error}</p>}
        {!loading && !error && orders.length === 0 && (
          <p className="status-msg">Пока нет заказов.</p>
        )}

        <div className="order-grid">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      </section>

      {vacancies.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Свежие вакансии</h2>
            <Link to="/vacancies">Смотреть все →</Link>
          </div>
          <div className="order-grid">
            {vacancies.map((v) => (
              <VacancyCard key={v.id} vacancy={v} />
            ))}
          </div>
        </section>
      )}

      {stats && (
        <section className="stats-bar">
          <div>
            <div className="stat-value">{stats.usersCount}+</div>
            <div className="stat-label">пользователей</div>
          </div>
          <div>
            <div className="stat-value">{stats.activeOrders}+</div>
            <div className="stat-label">активных заказов</div>
          </div>
          <div>
            <div className="stat-value">{stats.citiesCount}</div>
            <div className="stat-label">городов Кыргызстана</div>
          </div>
          <div>
            <div className="stat-value">0%</div>
            <div className="stat-label">комиссия сайта</div>
          </div>
        </section>
      )}

      {cityCounts.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Заказы по городам</h2>
          </div>
          <div className="city-pills">
            {cityCounts.map((c) => (
              <Link key={c.city} to={`/orders?city=${encodeURIComponent(c.city)}`} className="city-pill">
                {c.city} <span className="count">{c.count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

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

      <section className="cta-banner">
        <h2>Ищете подработку?</h2>
        <p>Смотрите свежие заказы и пишите заказчикам напрямую в WhatsApp — без регистрации.</p>
        <Link to="/orders">Найти работу →</Link>
      </section>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import OrderCard from '../components/OrderCard';
import VacancyCard from '../components/VacancyCard';
import FormatIcon from '../components/FormatIcon';
import CityAutocomplete from '../components/CityAutocomplete';
import { useFavorites } from '../context/FavoritesContext';
import { followerWord } from '../plural';
import { SkeletonOrderCard, SkeletonCityPills } from '../components/Skeleton';

const INSTAGRAM_URL = 'https://www.instagram.com/shabashka.com_/';
const TELEGRAM_URL = 'https://t.me/Shabashkacom';

export default function Home() {
  const navigate = useNavigate();
  const { keys: favoriteKeys } = useFavorites();
  const [cities, setCities] = useState([]);
  const [orders, setOrders] = useState([]);
  const [vacancies, setVacancies] = useState([]);
  const [cityCounts, setCityCounts] = useState([]);
  const [instagramFollowers, setInstagramFollowers] = useState(null);
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
        setCityCounts(data.cityCounts);
        setInstagramFollowers(data.instagramFollowers);
        setOrders(data.orders);
        setVacancies(data.vacancies);
        setCities(data.cities);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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
          пишут в WhatsApp или в сообщениях на сайте. Регистрация не нужна, чтобы откликнуться в
          WhatsApp.
        </p>
        <form className="search-bar" onSubmit={submitSearch}>
          <input
            className="search-q"
            placeholder="Что нужно сделать? Например: убрать квартиру"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
          <div className="search-divider" />
          <CityAutocomplete
            className="search-city"
            placeholder="Город"
            cities={cities}
            value={cityInput}
            onChange={setCityInput}
          />
          <button type="submit">Найти</button>
        </form>
        <div className="hero-format-links">
          <span className="hero-format-label">Смотреть подработку:</span>
          <Link to="/orders">Всю</Link>
          <Link to="/orders?workFormat=offline" className="hero-format-link">
            <FormatIcon name="offline" size={15} /> Только офлайн
          </Link>
          <Link to="/orders?workFormat=online" className="hero-format-link">
            <FormatIcon name="online" size={15} /> Только онлайн
          </Link>
        </div>
        {favoriteKeys.length > 0 && (
          <Link to="/favorites" className="hero-fav-link">
            ★ Избранное ({favoriteKeys.length})
          </Link>
        )}
        <div className="hero-social">
          <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer me" className="hero-social-link">
            📸 Instagram
            {instagramFollowers != null && (
              <span className="hero-social-count">
                {instagramFollowers.toLocaleString('ru')} {followerWord(instagramFollowers)}
              </span>
            )}
          </a>
          <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer me" className="hero-social-link">
            ✈️ Telegram-канал
          </a>
        </div>
      </section>

      {/* Ни плитки категорий, ни полосы со счётчиками: до объявлений человек
          доходил через два экрана выбора, а пришёл он смотреть объявления.
          Категории остались фильтром на /orders — там их ищут осознанно. */}

      <section className="section">
        <div className="section-head">
          <h2>Свежие заказы</h2>
          <Link to="/orders">Смотреть все →</Link>
        </div>

        {error && <p className="status-msg error">{error}</p>}
        {!loading && !error && orders.length === 0 && (
          <p className="status-msg">Пока нет заказов.</p>
        )}

        <div className="order-grid">
          {loading && Array.from({ length: 12 }).map((_, i) => <SkeletonOrderCard key={i} />)}
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      </section>

      {loading && (
        <section className="section">
          <div className="section-head">
            <h2>Свежие вакансии</h2>
          </div>
          <div className="order-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonOrderCard key={i} />
            ))}
          </div>
        </section>
      )}

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

      {loading && (
        <section className="section">
          <div className="section-head">
            <h2>Заказы по городам</h2>
          </div>
          <SkeletonCityPills />
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

      <section className="cta-banner">
        <h2>Хотите найти ещё?</h2>
        <p>Новые заказы и вакансии появляются каждый день — заходите почаще.</p>
        <Link to="/orders">Смотреть все заказы →</Link>
      </section>
    </div>
  );
}

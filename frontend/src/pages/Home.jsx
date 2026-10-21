import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import OrderCard from '../components/OrderCard';
import VacancyCard from '../components/VacancyCard';
import LandingLinks from '../components/LandingLinks';
import TaskCard from '../components/TaskCard';
import AdCard from '../components/AdCard';
import CityAutocomplete from '../components/CityAutocomplete';
import { useFavorites } from '../context/FavoritesContext';
import { adWord, followerWord, orderWord, taskWord, vacancyWord } from '../plural';
import { SkeletonOrderCard, SkeletonCityPills } from '../components/Skeleton';
import { SOCIALS, SocialIcon } from '../components/SocialLinks';

// «Часто ищут» под поиском — слова, по которым на сайте точно есть заказы
// (проверено на живом сайте 2026-10-18: уборка 17, грузчик 15, ремонт 12,
// электрик 6, швея 4). Поиск ищет подстроку, поэтому «Грузчик» найдёт и
// «грузчики».
const POPULAR = ['Уборка', 'Грузчик', 'Ремонт', 'Электрик', 'Швея'];

// Живая строка над заголовком: «+19 заказов и +73 вакансии за сутки». Нулевые
// части пропускаем, а если за сутки не добавилось ничего — строки нет вовсе:
// «+0 заказов» говорит о заброшенном сайте, а не о живом.
function freshLine(counts) {
  if (!counts) return null;
  const parts = [];
  if (counts.today_orders > 0) parts.push(`+${counts.today_orders} ${orderWord(counts.today_orders)}`);
  if (counts.today_vacancies > 0) parts.push(`+${counts.today_vacancies} ${vacancyWord(counts.today_vacancies)}`);
  return parts.length ? `${parts.join(' и ')} за сутки` : null;
}

// «Что ищете?» — четыре раздела сайта сразу под поиском. Раньше с первого
// экрана вела только строка «Смотреть подработку: Всю / Офлайн / Онлайн», а
// вакансии, биржа и объявления оттуда не были видны вовсе.
const TILES = [
  { to: '/orders', icon: '🧰', label: 'Подработка', count: 'orders', word: orderWord, hint: 'разовая работа' },
  { to: '/vacancies', icon: '💼', label: 'Вакансии', count: 'vacancies', word: vacancyWord, hint: 'работа в штат' },
  { to: '/tasks', icon: '⚡', label: 'Биржа', count: 'tasks', word: taskWord, hint: 'исполнители предложат цену' },
  { to: '/ads', icon: '🏷', label: 'Объявления', count: 'ads', word: adWord, hint: 'сдам, продам, услуги' },
];

// Пока счётчики не пришли или раздел пуст — подсказка вместо числа, а не «0 задач».
function tileNote(tile, counts) {
  const n = counts && counts[tile.count];
  return Number.isInteger(n) && n > 0 ? `${n.toLocaleString('ru-RU')} ${tile.word(n)}` : tile.hint;
}

export default function Home() {
  const navigate = useNavigate();
  const { keys: favoriteKeys } = useFavorites();
  const [cities, setCities] = useState([]);
  const [orders, setOrders] = useState([]);
  const [vacancies, setVacancies] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [ads, setAds] = useState([]);
  const [counts, setCounts] = useState(null);
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
        setTasks(data.tasks || []);
        setAds(data.ads || []);
        setCounts(data.counts || null);
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

  const fresh = freshLine(counts);

  return (
    <div>
      <section className="hero">
        {/* Пока главная грузится, плашка стоит невидимой — иначе заголовок
            съезжал бы вниз, когда придут числа. */}
        {(loading || fresh) && (
          <div className={`hero-live${fresh ? '' : ' is-pending'}`}>
            <span className="hero-live-dot" aria-hidden="true" />
            {fresh || 'Загружаем свежие заказы'}
          </div>
        )}
        <h1>
          <span className="hero-brand">Шабашка</span> в Кыргызстане
        </h1>
        <p>Подработка, вакансии, мастера и объявления рядом с вами — без посредников и комиссии.</p>
        {/* Чем сайт лучше самих чатов: фильтр. Без этой строки «из чатов» на
            карточках читалось как «то же самое, что у вас в группе». */}
        <p className="hero-trust">
          🛡 Объявления из чатов проходят фильтр: без сетевого маркетинга, вербовки за границу и схем с чужими
          документами
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
        <div className="hero-popular">
          <span className="hero-popular-label">Часто ищут:</span>
          {POPULAR.map((word) => (
            <Link key={word} to={`/orders?q=${encodeURIComponent(word.toLowerCase())}`} className="hero-popular-link">
              {word}
            </Link>
          ))}
        </div>
        <nav className="home-tiles" aria-label="Разделы сайта">
          {TILES.map((tile) => (
            <Link key={tile.to} to={tile.to} className="home-tile">
              <span className="home-tile-icon" aria-hidden="true">
                {tile.icon}
              </span>
              <span className="home-tile-text">
                <span className="home-tile-label">{tile.label}</span>
                <span className="home-tile-note">{tileNote(tile, counts)}</span>
              </span>
            </Link>
          ))}
        </nav>
        {/* Студенты ищут не категорию, а работу, которую потянут вместе с учёбой, —
            поэтому отдельной синей плашкой, как их выпуски в Instagram. */}
        <div className="hero-extra">
          <Link to="/vacancies?students=1" className="hero-students-link">
            🎓 Работа для студентов
          </Link>
          {favoriteKeys.length > 0 && (
            <Link to="/favorites" className="hero-fav-link">
              ★ Избранное ({favoriteKeys.length})
            </Link>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Свежие заказы</h2>
          <Link to="/orders">Все заказы</Link>
        </div>

        {error && <p className="status-msg error">{error}</p>}
        {!loading && !error && orders.length === 0 && <p className="status-msg">Пока нет заказов.</p>}

        <div className="order-grid">
          {loading && Array.from({ length: 8 }).map((_, i) => <SkeletonOrderCard key={i} />)}
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      </section>

      {/* Биржа — компактной полосой: заказчику она нужна как действие («разместить
          задачу»), а не как ещё одна лента. Пустую сетку не рисуем. */}
      <section className="section exchange-promo">
        <div className="exchange-promo-head">
          <div>
            <h2>Биржа услуг</h2>
            <p>Опишите задачу — исполнители сами предложат цену и срок, а вы выберете лучшего.</p>
          </div>
          <div className="exchange-promo-actions">
            <Link to="/tasks/new" className="cta">
              + Разместить задачу
            </Link>
            <Link to="/tasks" className="exchange-promo-all">
              Все задачи
            </Link>
          </div>
        </div>
        {tasks.length > 0 && (
          <div className="order-grid">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        )}
      </section>

      {/* Объявления — только когда они есть: пустой блок с одной кнопкой на
          главной выглядел бы заброшенным разделом. */}
      {ads.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Свежие объявления</h2>
            <Link to="/ads">Все объявления</Link>
          </div>
          <div className="ad-grid">
            {ads.map((ad) => (
              <AdCard key={ad.id} ad={ad} />
            ))}
          </div>
        </section>
      )}

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
            <Link to="/vacancies">Все вакансии</Link>
          </div>
          <div className="order-grid">
            {vacancies.map((v) => (
              <VacancyCard key={v.id} vacancy={v} />
            ))}
          </div>
        </section>
      )}

      <LandingLinks />

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

      {/* Соцсети — внизу, а не на первом экране: на сайт приходят искать работу,
          а не подписываться. Ссылки нужны и поисковику (см. Footer.jsx). */}
      <section className="section home-social">
        <h2>Свежие объявления каждый день в наших соцсетях</h2>
        <div className="hero-social">
          {SOCIALS.map((s) => (
            <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer me" className="hero-social-link">
              <SocialIcon id={s.id} />
              {s.name}
              {s.id === 'instagram' && instagramFollowers != null && (
                <span className="hero-social-count">
                  {instagramFollowers.toLocaleString('ru')} {followerWord(instagramFollowers)}
                </span>
              )}
            </a>
          ))}
        </div>
      </section>

      {/* Раньше здесь было «заходите почаще» — а повода зайти снова не было.
          Подписка в боте и есть этот повод (см. SubscribeButton). */}
      <section className="cta-banner">
        <h2>Не пропустите новую работу</h2>
        <p>
          Бот в Telegram пришлёт свежие вакансии по вашей профессии: раз в час днём и только когда есть новые. Без
          регистрации.
        </p>
        <div className="cta-banner-actions">
          <a href={api.subscribeUrl()} target="_blank" rel="noopener noreferrer">
            🔔 Подписаться в Telegram
          </a>
          <Link to="/orders" className="cta-banner-ghost">
            Смотреть все заказы
          </Link>
        </div>
      </section>
    </div>
  );
}

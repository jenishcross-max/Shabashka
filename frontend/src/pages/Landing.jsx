import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import VacancyCard from '../components/VacancyCard';
import OrderCard from '../components/OrderCard';
import LandingLinks from '../components/LandingLinks';
import { SkeletonOrderCard } from '../components/Skeleton';
import { useMeta } from '../useMeta';
import { landingBySlug, listPath } from '../landings';
import { orderWord, vacancyWord } from '../plural';
import NotFound from './NotFound';

const PAGE = 24;

// Посадочная страница /rabota/<slug>: профессия или подборка под поисковый
// запрос («работа официантом Бишкек», «подработка на сегодня»). Тексты и
// фильтры — в landings.js; заголовок и описание те же видит и робот — их
// подставляет edge-функция Netlify ещё до JavaScript.
export default function Landing() {
  const { slug } = useParams();
  const landing = landingBySlug(slug);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useMeta(landing && `${landing.title} — Шабашка`, landing && landing.description);

  useEffect(() => {
    if (!landing) return;
    setLoading(true);
    setError('');
    const load = landing.kind === 'orders' ? api.orders : api.vacancies;
    load({ ...landing.params, limit: PAGE })
      .then((data) => {
        setItems(data[landing.kind]);
        setTotal(data.total);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  if (!landing) return <NotFound />;

  const ky = landing.lang === 'ky';
  const word = landing.kind === 'orders' ? orderWord : vacancyWord;
  const card = (item) =>
    landing.kind === 'orders' ? <OrderCard key={item.id} order={item} /> : <VacancyCard key={item.id} vacancy={item} />;

  return (
    <div className="landing" lang={landing.lang}>
      <header className="landing-head">
        <h1>{landing.h1}</h1>
        <p className="landing-intro">{landing.intro}</p>
        {total !== null && (
          <p className="landing-count">
            {ky ? `Азыр ${total} вакансия ачык` : `Сейчас открыто: ${total} ${word(total)}`}
          </p>
        )}
        {/* Повод вернуться: бот раз в час пришлёт новые вакансии этой профессии
            (см. backend/src/telegram/subscriptions.js). У подборок — меню бота.
            Бот присылает только вакансии — у заказов кнопки нет. */}
        {landing.kind === 'vacancies' && (
          <a className="landing-subscribe" href={api.subscribeUrl(landing.slug)} target="_blank" rel="noopener noreferrer">
            {ky
              ? `🔔 Жаңы вакансиялар — Telegram'да`
              : landing.group === 'profession'
                ? `🔔 Новые вакансии «${landing.short}» в Telegram`
                : '🔔 Новые вакансии в Telegram'}
          </a>
        )}
      </header>

      {error && <p className="status-msg error">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="status-msg">
          {ky ? 'Азырынча бош — жаңылары күн сайын кошулат.' : 'Сейчас здесь пусто — новые объявления появляются каждый день.'}
        </p>
      )}

      <div className="order-grid">
        {loading && Array.from({ length: 6 }).map((_, i) => <SkeletonOrderCard key={i} />)}
        {!loading && items.map(card)}
      </div>

      {total > items.length && (
        <div className="landing-more">
          <Link to={listPath(landing)} className="cta">
            {ky ? `Баарын көрүү (${total})` : `Смотреть все ${total} ${word(total)}`}
          </Link>
        </div>
      )}

      <LandingLinks current={landing.slug} />
    </div>
  );
}

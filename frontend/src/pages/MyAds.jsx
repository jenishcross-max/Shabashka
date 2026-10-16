import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { relativeDate } from '../formatDate';
import { viewWord } from '../plural';
import { bumpHint } from '../bump';
import { KIND_LABELS, STATUS_LABELS, priceLabel } from '../ads';
import MyListingsTabs from '../components/MyListingsTabs';
import { SkeletonMyOrderRow } from '../components/Skeleton';

// Мои объявления — все, включая закрытые и снятые модератором: автор должен
// видеть, что случилось с объявлением, а не гадать, куда оно пропало.
// Здесь только быстрые действия; правка и удаление — на странице объявления.
export default function MyAds() {
  const { token } = useAuth();
  const [ads, setAds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});

  useEffect(() => {
    api
      .myAds(token)
      .then(({ ads }) => setAds(ads))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function step(ad, name) {
    setBusyId(ad.id);
    setNotes((n) => ({ ...n, [ad.id]: '' }));
    try {
      const { ad: fresh } = await api.adStep(ad.id, name, token);
      setAds((list) => list.map((a) => (a.id === fresh.id ? fresh : a)));
      if (name === 'bump') setNotes((n) => ({ ...n, [ad.id]: 'Поднято в начало ленты' }));
    } catch (e) {
      setNotes((n) => ({ ...n, [ad.id]: e.message }));
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div>
      <MyListingsTabs active="ads" />
      <div className="my-orders-head">
        <h1>Мои объявления</h1>
        <Link to="/ads/new" className="cta">
          + Новое объявление
        </Link>
      </div>
      <div className="my-orders-list">
        {loading && (
          <>
            <SkeletonMyOrderRow />
            <SkeletonMyOrderRow />
          </>
        )}
        {!loading && ads.length === 0 && (
          <p className="status-msg">
            Вы ещё не подавали объявлений. <Link to="/ads/new">Подать первое</Link>
          </p>
        )}
        {!loading &&
          ads.map((ad) => {
            const hint = ad.status === 'open' ? bumpHint(ad) : '';
            return (
              <div key={ad.id} className={`my-order-row my-ad-row${ad.status === 'open' ? '' : ' closed'}`}>
                {ad.photos[0] ? (
                  <img className="my-ad-thumb" src={ad.photos[0].url} alt="" loading="lazy" />
                ) : (
                  <span className="my-ad-thumb empty" />
                )}
                <div className="my-ad-main">
                  <div className="my-order-title-row">
                    <Link to={`/ads/${ad.id}`}>{ad.title}</Link>
                    <span className={`badge ${ad.status === 'open' ? 'status-open' : 'status-closed'}`}>
                      {STATUS_LABELS[ad.status]}
                    </span>
                  </div>
                  <div className="my-order-meta">
                    {KIND_LABELS[ad.kind]}
                    {ad.kind === 'free' ? '' : ` · ${priceLabel(ad)}`} · {ad.city} · {ad.views} {viewWord(ad.views)} ·{' '}
                    {relativeDate(ad.created_at)}
                  </div>
                  {notes[ad.id] && <div className="my-order-meta">{notes[ad.id]}</div>}
                </div>
                <div className="my-order-actions">
                  {ad.status === 'open' && (
                    <>
                      <button type="button" disabled={busyId === ad.id || !!hint} title={hint} onClick={() => step(ad, 'bump')}>
                        Поднять
                      </button>
                      <button type="button" disabled={busyId === ad.id} onClick={() => step(ad, 'close')}>
                        Закрыть
                      </button>
                    </>
                  )}
                  {ad.status === 'closed' && (
                    <button type="button" disabled={busyId === ad.id} onClick={() => step(ad, 'reopen')}>
                      Открыть снова
                    </button>
                  )}
                  {ad.status !== 'removed' && <Link to={`/ads/${ad.id}/edit`}>Изменить</Link>}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

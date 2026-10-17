import { Link } from 'react-router-dom';
import { relativeDate } from '../formatDate';
import { CATEGORY_LABELS, KIND_LABELS, priceLabel } from '../ads';
import FavoriteButton from './FavoriteButton';
import { CardFlags } from './ListingCard';

// Карточка объявления. В отличие от заказа, здесь главное — фото: квартиру и
// пансионат выбирают глазами, поэтому обложка сверху, а текст короче. Цена,
// «где и когда» и значки — те же, что у остальных карточек сайта.
export default function AdCard({ ad }) {
  const cover = ad.photos[0]?.url;
  return (
    <Link to={`/ads/${ad.id}`} className="ad-card">
      <div className={`ad-card-cover${cover ? '' : ' empty'}`}>
        {cover ? <img src={cover} alt="" loading="lazy" /> : <span>Без фото</span>}
        <span className="ad-card-kind">{KIND_LABELS[ad.kind]}</span>
        {ad.photos.length > 1 && <span className="ad-card-count">📷 {ad.photos.length}</span>}
        <FavoriteButton type="ad" id={ad.id} className="ad-card-fav" />
      </div>
      <div className="ad-card-body">
        <span className={`budget${ad.price == null && ad.kind !== 'free' ? ' muted-budget' : ''}`}>{priceLabel(ad)}</span>
        <h3>{ad.title}</h3>
        <span className="ad-card-meta">
          {CATEGORY_LABELS[ad.category]}, {ad.city}
        </span>
        <span className="ad-card-foot">
          <span className="date">{relativeDate(ad.bumped_at || ad.created_at)}</span>
          <CardFlags imported={!!ad.is_imported} />
        </span>
      </div>
    </Link>
  );
}

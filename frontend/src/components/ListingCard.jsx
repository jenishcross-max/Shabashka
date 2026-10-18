import { Link } from 'react-router-dom';
import FavoriteButton from './FavoriteButton';
import FormatIcon from './FormatIcon';
import { StudentBadge } from './StudentField';

// Одна схема для заказа, вакансии и задачи биржи: раньше у каждой карточки был
// свой набор плашек, и рядом на главной они выглядели тремя разными сайтами.
// Сверху — одна плашка и «где и когда», внизу — крупная цена и значки только по
// делу. «Офлайн» не показываем: так работает большинство, и значок ничего не
// сообщал; «Онлайн» — показываем.
export default function ListingCard({ to, badge, city, date, favorite, title, detail, description, price, priceMuted, flags }) {
  return (
    <Link to={to} className="order-card">
      <div className="order-card-top">
        <span className="badge">{badge}</span>
        <span className="order-card-where">
          <span className="order-city">{city}</span>
          <span className="date">{date}</span>
        </span>
        {favorite && <FavoriteButton type={favorite.type} id={favorite.id} className="order-card-fav" />}
      </div>
      <h3>{title}</h3>
      {detail && <p className="order-card-detail">{detail}</p>}
      <p>{description}</p>
      <div className="order-card-bottom">
        <span className={`budget${priceMuted ? ' muted-budget' : ''}`}>{price}</span>
        <CardFlags {...flags} />
      </div>
    </Link>
  );
}

// Значки внизу карточки. online, students, pinned, example, imported — булевы.
export function CardFlags({ online, students, pinned, example, imported } = {}) {
  if (!online && !students && !pinned && !example && !imported) return null;
  return (
    <span className="order-card-flags">
      {pinned && <span className="badge pinned">🔥 Топ</span>}
      {students && <StudentBadge />}
      {online && (
        <span className="card-flag">
          <FormatIcon name="online" size={13} /> Онлайн
        </span>
      )}
      {imported && (
        <span
          className="card-flag"
          title="Взято из открытых чатов и прошло фильтр на сетевой маркетинг и мошенничество. Автора мы не проверяли"
        >
          Из чатов
        </span>
      )}
      {example && <span className="badge badge-example">Пример</span>}
    </span>
  );
}

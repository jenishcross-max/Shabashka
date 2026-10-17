import { relativeDate } from '../formatDate';
import ListingCard from './ListingCard';

export default function OrderCard({ order }) {
  return (
    <ListingCard
      to={`/orders/${order.id}`}
      badge={order.category}
      city={order.city}
      date={relativeDate(order.created_at)}
      favorite={{ type: 'order', id: order.id }}
      title={order.title}
      description={order.description}
      price={order.budget ? `${order.budget.toLocaleString('ru-RU')} сом` : 'По договорённости'}
      priceMuted={!order.budget}
      flags={{
        online: order.work_format === 'online',
        students: !!order.for_students,
        pinned: !!order.pinned,
        example: !!order.is_example,
        imported: !!order.is_imported,
      }}
    />
  );
}

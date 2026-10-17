import { relativeDate } from '../formatDate';
import { offerWord } from '../plural';
import { taskBudget } from '../exchange';
import ListingCard from './ListingCard';

// Карточка задачи биржи — та же схема, что у заказа. Отличие — число откликов:
// по нему исполнитель понимает, стоит ли ещё предлагать цену.
export default function TaskCard({ task }) {
  return (
    <ListingCard
      to={`/tasks/${task.id}`}
      badge={task.category}
      city={task.city}
      date={relativeDate(task.created_at)}
      title={task.title}
      detail={task.offers_count > 0 ? `${task.offers_count} ${offerWord(task.offers_count)}` : 'Пока без откликов'}
      description={task.description}
      price={taskBudget(task)}
      priceMuted={!task.budget}
      flags={{ online: task.work_format === 'online' }}
    />
  );
}

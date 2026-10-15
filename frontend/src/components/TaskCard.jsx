import { Link } from 'react-router-dom';
import { relativeDate } from '../formatDate';
import { offerWord } from '../plural';
import { taskBudget } from '../exchange';
import FormatIcon from './FormatIcon';

// Карточка задачи биржи — в тех же классах, что карточка заказа, чтобы лента
// биржи и лента заказов выглядели одним сайтом. Отличие — число откликов: по
// нему исполнитель понимает, стоит ли ещё предлагать цену.
export default function TaskCard({ task }) {
  return (
    <Link to={`/tasks/${task.id}`} className="order-card">
      <div className="order-card-top">
        <div className="order-card-badges">
          <span className="badge">{task.category}</span>
          <span className="badge badge-format">
            <FormatIcon name={task.work_format === 'online' ? 'online' : 'offline'} size={14} />
            {task.work_format === 'online' ? 'Онлайн' : 'Офлайн'}
          </span>
        </div>
        <div className="order-card-top-right">
          <span className="order-city">{task.city}</span>
        </div>
      </div>
      <h3>{task.title}</h3>
      <p>{task.description}</p>
      <div className="order-card-bottom">
        <span className={`budget${task.budget ? '' : ' muted-budget'}`}>{taskBudget(task)}</span>
        <span className="date">
          {task.offers_count > 0 ? `${task.offers_count} ${offerWord(task.offers_count)}` : 'Пока без откликов'} ·{' '}
          {relativeDate(task.created_at)}
        </span>
      </div>
    </Link>
  );
}

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { relativeDate } from '../formatDate';
import { offerWord } from '../plural';
import { OFFER_STATE_LABELS, TASK_STATUS_LABELS, statusClass, som, taskBudget } from '../exchange';
import MyListingsTabs from '../components/MyListingsTabs';
import { SkeletonMyOrderRow } from '../components/Skeleton';

// «Моё на бирже»: один человек бывает и заказчиком, и исполнителем, поэтому
// здесь две половины — задачи, которые я разместил, и отклики, которые я отправил.
// Какая открыта — в адресе (?tab=offers), чтобы ссылка вела сразу куда нужно.

// Отклик ещё в игре (ждёт или выбран) — зелёный значок, иначе — красный.
const LIVE_STATES = ['waiting', 'chosen', 'done'];

function MyTaskRows({ tasks }) {
  if (tasks.length === 0) {
    return (
      <p className="status-msg">
        Вы ещё не размещали задач. <Link to="/tasks/new">Разместить первую</Link>
      </p>
    );
  }
  return tasks.map((task) => (
    <div key={task.id} className={`my-order-row${statusClass(task.status) === 'status-closed' ? ' closed' : ''}`}>
      <div>
        <div className="my-order-title-row">
          <Link to={`/tasks/${task.id}`}>{task.title}</Link>
          <span className={`badge ${statusClass(task.status)}`}>{TASK_STATUS_LABELS[task.status]}</span>
          {task.new_offers > 0 && <span className="offer-new">+{task.new_offers} новых</span>}
        </div>
        <div className="my-order-meta">
          {task.city} · {taskBudget(task)} · {task.offers_count} {offerWord(task.offers_count)} ·{' '}
          {relativeDate(task.created_at)}
        </div>
      </div>
      <div className="my-order-actions">
        <Link to={`/tasks/${task.id}`}>{task.status === 'open' && task.offers_count > 0 ? 'Выбрать' : 'Открыть'}</Link>
      </div>
    </div>
  ));
}

function MyOfferRows({ offers }) {
  if (offers.length === 0) {
    return (
      <p className="status-msg">
        Вы ещё не откликались. <Link to="/tasks">Посмотреть задачи на бирже</Link>
      </p>
    );
  }
  return offers.map((offer) => (
    <div key={offer.id} className={`my-order-row${LIVE_STATES.includes(offer.state) ? '' : ' closed'}`}>
      <div>
        <div className="my-order-title-row">
          <Link to={`/tasks/${offer.task_id}`}>{offer.task_title}</Link>
          <span className={`badge ${LIVE_STATES.includes(offer.state) ? 'status-open' : 'status-closed'}`}>
            {OFFER_STATE_LABELS[offer.state]}
          </span>
        </div>
        <div className="my-order-meta">
          {offer.task_city} · ваша цена {som(offer.price)} · {offer.term}
        </div>
      </div>
      {offer.state === 'chosen' && offer.conversation_id && (
        <div className="my-order-actions">
          <Link to={`/messages/${offer.conversation_id}`}>Переписка</Link>
        </div>
      )}
    </div>
  ));
}

export default function MyTasks() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'offers' ? 'offers' : 'tasks';
  const [tasks, setTasks] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([api.myTasks(token), api.myOffers(token)])
      .then(([mine, sent]) => {
        setTasks(mine.tasks);
        setOffers(sent.offers);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (error) return <p className="status-msg error">{error}</p>;

  const newTotal = tasks.reduce((sum, t) => sum + t.new_offers, 0);

  return (
    <div>
      <MyListingsTabs active="tasks" />
      <div className="my-orders-head">
        <h1>Моё на бирже</h1>
        <Link to="/tasks/new" className="cta">
          + Новая задача
        </Link>
      </div>
      <div className="my-tasks-switch">
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setSearchParams({})}>
          Мои задачи
          {newTotal > 0 && <span className="nav-unread-badge">{newTotal}</span>}
        </button>
        <button className={tab === 'offers' ? 'active' : ''} onClick={() => setSearchParams({ tab: 'offers' })}>
          Мои отклики
        </button>
      </div>
      <div className="my-orders-list">
        {loading && (
          <>
            <SkeletonMyOrderRow />
            <SkeletonMyOrderRow />
          </>
        )}
        {!loading && (tab === 'tasks' ? <MyTaskRows tasks={tasks} /> : <MyOfferRows offers={offers} />)}
      </div>
    </div>
  );
}

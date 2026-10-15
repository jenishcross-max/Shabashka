import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useUnread } from '../context/UnreadContext';
import { relativeDate } from '../formatDate';
import { useMeta } from '../useMeta';
import { offerWord, viewWord } from '../plural';
import { TASK_STATUS_LABELS, statusClass, som, trustLine } from '../exchange';
import FormatIcon from '../components/FormatIcon';
import SafetyNote from '../components/SafetyNote';
import { SkeletonOrderDetail } from '../components/Skeleton';

// Страница задачи биржи. Одна страница на троих — гостя, исполнителя и
// заказчика: задача у всех одна, а разница только в нижнем блоке. Заказчик
// видит отклики целиком, исполнитель — только свой, гость — их число.

function OfferForm({ initial, submitLabel, busy, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    price: initial ? String(initial.price) : '',
    term: initial?.term || '',
    comment: initial?.comment || '',
  });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <form
      className="offer-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      <div className="field-row">
        <label className="field">
          <span className="label">Ваша цена, сом</span>
          <input type="number" min="1" step="1" required placeholder="2500" value={form.price} onChange={set('price')} />
        </label>
        <label className="field">
          <span className="label">Срок</span>
          <input required maxLength={60} placeholder="Например: завтра до обеда" value={form.term} onChange={set('term')} />
        </label>
      </div>
      <label className="field">
        <span className="label">Что сделаете</span>
        <textarea
          required
          rows={3}
          maxLength={1000}
          placeholder="Как будете делать, что возьмёте с собой, есть ли опыт"
          value={form.comment}
          onChange={set('comment')}
        />
      </label>
      <div className="offer-form-actions">
        <button className="submit-btn" type="submit" disabled={busy}>
          {busy ? 'Отправляем…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="admin-btn-ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </button>
        )}
      </div>
      <p className="format-hint">
        Отклик увидит только заказчик. Пока он не выбрал исполнителя, отклик можно изменить или отозвать.
      </p>
    </form>
  );
}

function OfferCard({ offer, mine = false, children }) {
  return (
    <div className={`offer-card${offer.status === 'accepted' ? ' chosen' : ''}`}>
      <div className="offer-card-head">
        <div>
          <span className="offer-name">{mine ? 'Ваш отклик' : offer.user_name}</span>
          {offer.is_new && <span className="offer-new">Новый</span>}
          {!mine && <div className="offer-trust">{trustLine(offer)}</div>}
        </div>
        <div className="offer-price">{som(offer.price)}</div>
      </div>
      <div className="offer-term">Срок: {offer.term}</div>
      <p className="offer-comment">{offer.comment}</p>
      {children && <div className="offer-actions">{children}</div>}
    </div>
  );
}

// Что исполнитель видит про свой отклик (состояние — словом с сервера).
const MY_OFFER_NOTES = {
  done: 'Задача выполнена. Спасибо за работу!',
  other: 'Заказчик выбрал другого исполнителя.',
  cancelled: 'Заказчик отменил задачу.',
  withdrawn: 'Вы отозвали отклик.',
  dropped: 'Заказчик отменил выбор. Откликнуться на эту задачу снова нельзя.',
  removed: 'Ваш отклик снят модератором.',
};

const CLOSED_NOTES = {
  assigned: 'Исполнитель уже выбран — новые отклики не принимаются.',
  done: 'Задача выполнена.',
  cancelled: 'Задача отменена заказчиком.',
};

function WorkerPanel({ task, myOffer, chatId, user, busy, run }) {
  const [editing, setEditing] = useState(false);
  const open = task.status === 'open';

  const save = (form) =>
    run(async (token) => {
      await api.saveOffer(task.id, form, token);
      setEditing(false);
    });
  const withdraw = () => {
    if (!confirm('Отозвать отклик? Заказчик его больше не увидит.')) return;
    run((token) => api.withdrawOffer(task.id, token));
  };

  const count = (
    <p className="task-offers-count">
      {task.offers_count > 0
        ? `${task.offers_count} ${offerWord(task.offers_count)} на эту задачу`
        : 'Откликов пока нет — ваш может стать первым'}
    </p>
  );

  if (!user) {
    if (!open) return <p className="status-msg">{CLOSED_NOTES[task.status]}</p>;
    return (
      <div className="apply-box">
        <h3>Предложить свою цену</h3>
        {count}
        <p className="apply-login-hint">
          <Link to="/login" state={{ from: { pathname: `/tasks/${task.id}` } }}>
            Войдите
          </Link>{' '}
          или <Link to="/register">зарегистрируйтесь</Link>, чтобы откликнуться: указать цену, срок и
          что сделаете.
        </p>
      </div>
    );
  }

  const state = myOffer?.state;

  if (state === 'chosen') {
    return (
      <div className="task-chosen">
        <h3>Заказчик выбрал вас исполнителем</h3>
        <p>Договоритесь о деталях в переписке — там же телефон заказчика.</p>
        {chatId && (
          <Link to={`/messages/${chatId}`} className="cta">
            Перейти к переписке
          </Link>
        )}
      </div>
    );
  }

  if (state === 'waiting' && !editing) {
    return (
      <div className="apply-box">
        {count}
        <OfferCard offer={myOffer} mine>
          <button className="admin-btn-ghost" onClick={() => setEditing(true)} disabled={busy}>
            Изменить
          </button>
          <button className="admin-btn-ghost" onClick={withdraw} disabled={busy}>
            Отозвать
          </button>
        </OfferCard>
      </div>
    );
  }

  const canOffer = open && (!myOffer || state === 'waiting' || state === 'withdrawn');
  if (state && state !== 'waiting' && !(state === 'withdrawn' && editing)) {
    return (
      <div className="apply-box">
        <p className="status-msg">{MY_OFFER_NOTES[state]}</p>
        {state === 'withdrawn' && canOffer && (
          <button className="admin-btn-ghost" onClick={() => setEditing(true)}>
            Откликнуться снова
          </button>
        )}
      </div>
    );
  }

  if (!canOffer) return <p className="status-msg">{CLOSED_NOTES[task.status]}</p>;

  return (
    <div className="apply-box">
      <h3>{state === 'waiting' ? 'Изменить отклик' : 'Предложить свою цену'}</h3>
      {count}
      <OfferForm
        initial={myOffer}
        submitLabel={state === 'waiting' ? 'Сохранить отклик' : 'Отправить отклик'}
        busy={busy}
        onSubmit={save}
        onCancel={editing ? () => setEditing(false) : null}
      />
    </div>
  );
}

function OwnerPanel({ task, offers, chatId, busy, run }) {
  const chosen = offers.find((o) => o.status === 'accepted');

  const accept = (offer) => {
    const ok = confirm(
      `Выбрать ${offer.user_name} за ${som(offer.price)}? Новые отклики перестанут приниматься, ` +
        'остальные увидят, что выбран другой исполнитель.'
    );
    if (ok) run((token) => api.acceptOffer(task.id, offer.id, token));
  };
  const step = (name, question) => {
    if (question && !confirm(question)) return;
    run((token) => api.taskStep(task.id, name, token));
  };
  const reportOffer = (offer) => {
    const reason = window.prompt('Что не так с этим откликом? Например: просит предоплату');
    if (!reason || !reason.trim()) return;
    run(async (token) => {
      await api.reportOffer(task.id, offer.id, reason, token);
      alert('Жалоба отправлена — разберём в ближайшее время');
    });
  };

  const cancelTask = (task.status === 'open' || task.status === 'assigned') && (
    <button
      className="link-btn task-cancel"
      disabled={busy}
      onClick={() =>
        step('cancel', 'Отменить задачу? Она пропадёт из ленты, а откликнувшиеся увидят, что задача отменена.')
      }
    >
      Отменить задачу
    </button>
  );

  if (task.status === 'assigned' && chosen) {
    return (
      <div className="task-owner">
        <div className="task-chosen">
          <h3>Исполнитель выбран</h3>
          <OfferCard offer={chosen}>
            {chatId && (
              <Link to={`/messages/${chatId}`} className="cta">
                Написать исполнителю
              </Link>
            )}
            <button className="admin-btn-ghost" disabled={busy} onClick={() => step('done')}>
              Задача выполнена
            </button>
            <button
              className="admin-btn-ghost"
              disabled={busy}
              onClick={() =>
                step(
                  'unassign',
                  `Отменить выбор? Задача снова откроется для откликов, а ${chosen.user_name} не сможет откликнуться на неё снова.`
                )
              }
            >
              Отменить выбор
            </button>
          </OfferCard>
        </div>
        {cancelTask}
      </div>
    );
  }

  if (task.status === 'done') {
    return <p className="status-msg">Задача выполнена{chosen ? `. Исполнитель: ${chosen.user_name}` : ''}.</p>;
  }
  if (task.status === 'cancelled') return <p className="status-msg">Задача отменена.</p>;

  return (
    <div className="task-owner">
      <h3 className="desc-heading">Отклики ({offers.length})</h3>
      {offers.length === 0 && (
        <p className="status-msg">Откликов пока нет. Когда исполнители предложат цену, они появятся здесь.</p>
      )}
      <div className="offer-list">
        {offers.map((offer) => (
          <OfferCard key={offer.id} offer={offer}>
            <button className="cta" disabled={busy} onClick={() => accept(offer)}>
              Выбрать исполнителем
            </button>
            <button className="link-btn" disabled={busy} onClick={() => reportOffer(offer)}>
              Пожаловаться
            </button>
          </OfferCard>
        ))}
      </div>
      {cancelTask}
    </div>
  );
}

export default function TaskDetail() {
  const { id } = useParams();
  const { user, token, loading: authLoading } = useAuth();
  const { refreshUnread } = useUnread();
  const [data, setData] = useState(null);
  const [offers, setOffers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const [reportMsg, setReportMsg] = useState('');

  // Какая задача открыта сейчас: при переходе с /tasks/1 на /tasks/2 компонент
  // тот же, и запоздавший ответ про первую задачу не должен затереть вторую.
  const currentId = useRef(id);
  currentId.current = id;

  // Заказчику сразу и отклики: их открытие гасит значок «новые» в шапке.
  const load = useCallback(async () => {
    const result = await api.task(id, token);
    let ownerOffers = [];
    if (user && result.task.user_id === user.id) {
      ownerOffers = (await api.taskOffers(id, token)).offers;
      refreshUnread();
    }
    if (currentId.current !== id) return;
    setOffers(ownerOffers);
    setData(result);
  }, [id, token, user, refreshUnread]);

  useEffect(() => {
    if (authLoading) return;
    load().catch((e) => setError(e.message));
  }, [authLoading, load]);

  // Любое действие — и перечитать задачу: статусы меняют сразу несколько блоков.
  async function run(action) {
    setBusy(true);
    setActionError('');
    try {
      await action(token);
      await load();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const task = data?.task;
  useMeta(
    task && `${task.title} — биржа Шабашки`,
    task && `${task.category} · ${task.city} — ${task.description}`.slice(0, 160)
  );

  async function handleShare() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: task.title, url });
      } catch {
        // пользователь отменил — ничего не делаем
      }
      return;
    }
    await navigator.clipboard.writeText(url);
    setShareMsg('Ссылка скопирована');
    setTimeout(() => setShareMsg(''), 2500);
  }

  async function handleReport() {
    const reason = window.prompt('Опишите, что не так с этой задачей:');
    if (!reason || !reason.trim()) return;
    try {
      await api.reportTask(task.id, reason);
      setReportMsg('Жалоба отправлена — разберём в ближайшее время');
    } catch (err) {
      setReportMsg(err.message);
    }
    setTimeout(() => setReportMsg(''), 4000);
  }

  if (error) return <p className="status-msg error">{error}</p>;
  if (!data) return <SkeletonOrderDetail />;

  const isOwner = user?.id === task.user_id;

  return (
    <div className="order-detail-wrap">
      <Link to="/tasks" className="back-link">
        ← К бирже
      </Link>
      <div className="order-detail">
        <div className="badges-row">
          <span className="badge">{task.category}</span>
          <span className={`badge ${statusClass(task.status)}`}>{TASK_STATUS_LABELS[task.status]}</span>
          <span className="badge badge-format">
            <FormatIcon name={task.work_format === 'online' ? 'online' : 'offline'} size={14} />
            {task.work_format === 'online' ? 'Онлайн' : 'Офлайн'}
          </span>
        </div>
        <h1>{task.title}</h1>
        <p className="meta">
          <span>
            📍 {task.city}
            {task.address ? `, ${task.address}` : ''}
          </span>
          {task.when_text && <span>⏰ Когда: {task.when_text}</span>}
          <span>🗓 Опубликована {relativeDate(task.created_at)}</span>
          <span>👤 Заказчик: {task.owner_name}</span>
          <span>
            👁 {task.views} {viewWord(task.views)}
          </span>
        </p>

        <div className="budget-box">
          <span className="label">Бюджет заказчика</span>
          <span className={`value${task.budget ? '' : ' value-soft'}`}>
            {task.budget ? `до ${som(task.budget)}` : 'Цену предложат исполнители'}
          </span>
        </div>

        <h3 className="desc-heading">Описание задачи</h3>
        <p className="description">{task.description}</p>

        {actionError && <p className="status-msg error">{actionError}</p>}

        {isOwner ? (
          <OwnerPanel task={task} offers={offers} chatId={data.conversation_id} busy={busy} run={run} />
        ) : (
          <WorkerPanel
            task={task}
            myOffer={data.my_offer}
            chatId={data.conversation_id}
            user={user}
            busy={busy}
            run={run}
          />
        )}

        <SafetyNote />

        <div className="secondary-actions">
          <button type="button" onClick={handleShare}>
            🔗 {shareMsg || 'Поделиться'}
          </button>
          {isOwner ? (
            task.status === 'open' ? (
              <Link to={`/tasks/${task.id}/edit`} className="admin-btn-ghost secondary-link">
                ✏️ Изменить задачу
              </Link>
            ) : (
              <Link to="/my-tasks" className="admin-btn-ghost secondary-link">
                Моё на бирже
              </Link>
            )
          ) : (
            <button type="button" className="muted" onClick={handleReport}>
              ⚑ {reportMsg || 'Пожаловаться'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { relativeDate } from '../formatDate';
import { SkeletonTableRows } from '../components/Skeleton';

const TYPE_LABELS = { order: 'Заказ', vacancy: 'Вакансия', board: 'Доска' };
const PATHS = { order: '/orders/', vacancy: '/vacancies/' };
const key = (item) => `${item.type}:${item.id}`;

// Проверка опубликованного фильтром мошенников. Фильтр смотрит пост только
// когда тот приходит, а вышедшее до правки правил так и висит. Здесь — всё,
// что фильтр отсеял бы сейчас. Отмечено всё сразу: найденного бывает за сотню,
// и снимать по одному никто не станет, а ошибку фильтра проще снять галочкой.
export default function AdminSpam() {
  const { token } = useAuth();
  const [items, setItems] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  function load() {
    setLoading(true);
    api
      .adminSpamSweep(token)
      .then(({ items }) => {
        setItems(items);
        setPicked(new Set(items.map(key)));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token]);

  function toggle(item) {
    const next = new Set(picked);
    if (next.has(key(item))) next.delete(key(item));
    else next.add(key(item));
    setPicked(next);
  }

  async function removePicked() {
    const chosen = items.filter((i) => picked.has(key(i)));
    if (!confirm(`Снять с сайта ${chosen.length} шт.? Это необратимо: останется только запись в журнале модерации.`)) return;
    setBusy(true);
    setDone('');
    try {
      const { removed, blocked } = await api.adminSpamSweepRemove(
        chosen.map(({ type, id }) => ({ type, id })),
        token
      );
      setDone(`Снято: ${removed}. Номеров в чёрный список бота: ${blocked}.`);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div>
      <div className="admin-page-head">
        <div>
          <h1>Проверка фильтром</h1>
          <p className="admin-subtitle">
            Что сейчас висит на сайте и было бы отсеяно фильтром мошенников: оформление на чужие документы и
            сетевой найм. Снятое уходит в журнал модерации, номера — в чёрный список бота на 30 дней.
          </p>
        </div>
        {items.length > 0 && (
          <div className="admin-row-buttons">
            <button className="admin-btn-ghost" onClick={() => setPicked(new Set(items.map(key)))}>
              Отметить все
            </button>
            <button className="admin-btn-ghost" onClick={() => setPicked(new Set())}>
              Снять отметки
            </button>
            <button className="admin-btn-danger" disabled={busy || picked.size === 0} onClick={removePicked}>
              {busy ? 'Снимаю…' : `Снять с сайта (${picked.size})`}
            </button>
          </div>
        )}
      </div>
      {done && <p className="status-msg">{done}</p>}
      <div className="admin-card admin-table-card">
        <div className="admin-table admin-table-spam-wrap">
          <div className="admin-table-row admin-table-head admin-table-spam">
            <span></span>
            <span>Что</span>
            <span>Текст</span>
            <span>Почему</span>
          </div>
          {loading ? (
            <SkeletonTableRows columns={4} className="admin-table-spam" />
          ) : items.length === 0 ? (
            <p className="admin-subtitle admin-spam-empty">Фильтр ничего не нашёл — на сайте чисто.</p>
          ) : (
            items.map((item) => (
              <label className="admin-table-row admin-table-spam" key={key(item)}>
                <span>
                  <input type="checkbox" checked={picked.has(key(item))} onChange={() => toggle(item)} />
                </span>
                <span className="admin-subtitle">
                  {TYPE_LABELS[item.type]} #{item.id}
                  <div>{item.is_imported ? 'из групп' : 'с сайта'}</div>
                  <div>{relativeDate(item.created_at)}</div>
                </span>
                <span>
                  {PATHS[item.type] ? (
                    <Link to={`${PATHS[item.type]}${item.id}`} target="_blank" rel="noopener noreferrer">
                      {item.title}
                    </Link>
                  ) : (
                    item.title
                  )}
                  <div className="admin-subtitle admin-spam-excerpt">{item.excerpt}</div>
                </span>
                <span>
                  <span className={`badge ${item.kind === 'drop' ? 'status-closed' : 'status-open'}`}>{item.label}</span>
                  <div className="admin-subtitle">{item.reason}</div>
                </span>
              </label>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

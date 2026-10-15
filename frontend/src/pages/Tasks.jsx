import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useUnread } from '../context/UnreadContext';
import { useCities } from '../useCities';
import { useMeta } from '../useMeta';
import { pageList } from '../pagination';
import { taskWord } from '../plural';
import TaskCard from '../components/TaskCard';
import CityAutocomplete from '../components/CityAutocomplete';
import { SkeletonBox, SkeletonOrderCard } from '../components/Skeleton';

// Лента биржи: только открытые задачи. Фильтры живут в адресе — так ссылку на
// «уборка в Оше» можно переслать, и кнопка «назад» возвращает к тем же фильтрам.
export default function Tasks() {
  useMeta(
    'Биржа услуг — Шабашка',
    'Опишите задачу — исполнители в Кыргызстане предложат цену и срок, а вы выберете лучшего. Без комиссии.'
  );
  const { user } = useAuth();
  const { newOffers } = useUnread();
  const cities = useCities();
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [meta, setMeta] = useState({ total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const q = searchParams.get('q') || '';
  const city = searchParams.get('city') || '';
  const category = searchParams.get('category') || '';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);

  const [qInput, setQInput] = useState(q);
  const [cityInput, setCityInput] = useState(city);

  // Адрес мог смениться не из формы (пункт «Биржа» в меню сбрасывает фильтры) —
  // поля должны показывать то, по чему лента реально отфильтрована.
  useEffect(() => {
    setQInput(q);
    setCityInput(city);
  }, [q, city]);

  useEffect(() => {
    api
      .categories()
      .then(({ categories }) => setCategories(categories))
      .catch(() => {});
  }, []);

  // Ответ на прежние фильтры может прийти позже нового — его просто не берём.
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    api
      .tasks({ q, city, category, page })
      .then((data) => {
        if (!current) return;
        setTasks(data.tasks);
        setMeta({ total: data.total, pages: data.pages });
      })
      .catch((e) => current && setError(e.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [q, city, category, page]);

  function applyFilters(next) {
    const params = new URLSearchParams();
    const merged = { q, city, category, ...next };
    for (const [key, value] of Object.entries(merged)) {
      if (value && key !== 'page') params.set(key, value);
    }
    if (next.page > 1) params.set('page', next.page);
    setSearchParams(params);
  }

  function submit(e) {
    e.preventDefault();
    applyFilters({ q: qInput.trim(), city: cityInput.trim() });
  }

  return (
    <div>
      <div className="tasks-head">
        <div>
          <h1>Биржа услуг</h1>
          <p className="tasks-lead">
            Вы описываете задачу — исполнители предлагают цену и срок — вы выбираете одного.
          </p>
        </div>
        <div className="tasks-head-actions">
          {user && (
            <Link to="/my-tasks" className="admin-btn-ghost">
              Моё на бирже
              {newOffers > 0 && <span className="nav-unread-badge">{newOffers}</span>}
            </Link>
          )}
          <Link to="/tasks/new" className="cta">
            + Разместить задачу
          </Link>
        </div>
      </div>

      <form className="tasks-filters" onSubmit={submit}>
        <input
          placeholder="Что ищете? Например: уборка"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <CityAutocomplete placeholder="Город" cities={cities} value={cityInput} onChange={setCityInput} />
        <select value={category} onChange={(e) => applyFilters({ category: e.target.value })}>
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="submit">Найти</button>
      </form>

      <div className="orders-results-head">
        <span>
          {loading ? (
            <SkeletonBox width={90} height={14} />
          ) : (
            <>
              <strong>{meta.total}</strong> {taskWord(meta.total)}
            </>
          )}
        </span>
      </div>

      {error && <p className="status-msg error">{error}</p>}
      {!loading && !error && tasks.length === 0 && (
        <p className="status-msg">
          {q || city || category
            ? 'По этим фильтрам открытых задач нет.'
            : 'Пока нет открытых задач. Разместите первую — исполнители увидят её здесь.'}
        </p>
      )}

      <div className="order-grid">
        {loading && Array.from({ length: 6 }).map((_, i) => <SkeletonOrderCard key={i} />)}
        {!loading && tasks.map((task) => <TaskCard key={task.id} task={task} />)}
      </div>

      {meta.pages > 1 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => applyFilters({ page: page - 1 })}>
            ←
          </button>
          {pageList(page, meta.pages).map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} className="pagination-ellipsis">
                …
              </span>
            ) : (
              <button key={p} className={p === page ? 'active' : ''} onClick={() => applyFilters({ page: p })}>
                {p}
              </button>
            )
          )}
          <button disabled={page >= meta.pages} onClick={() => applyFilters({ page: page + 1 })}>
            →
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { relativeDate } from '../formatDate';
import Pagination from './Pagination';
import { SkeletonTableRows } from '../components/Skeleton';

// Сколько записке осталось жить — то же самое, что и на публичной доске.
function timeLeft(expiresAt) {
  const minutes = Math.floor((new Date(expiresAt) - Date.now()) / 60000);
  if (minutes <= 0) return 'вот-вот пропадёт';
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

export default function AdminBoard() {
  const { token } = useAuth();
  const [posts, setPosts] = useState([]);
  const [meta, setMeta] = useState({ page: 1, pages: 1, total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  function load() {
    setLoading(true);
    api
      .adminBoardPosts({ page, q: debouncedSearch }, token)
      .then(({ posts, ...rest }) => {
        setPosts(posts);
        setMeta(rest);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [token, page, debouncedSearch]);

  async function togglePinned(p) {
    await api.adminSetBoardPinned(p.id, !p.pinned, token);
    load();
  }

  async function toggleHidden(p) {
    await api.adminSetBoardHidden(p.id, !p.hidden, token);
    load();
  }

  async function removePost(p) {
    if (!confirm(`Удалить объявление ID ${p.id}? Это действие необратимо.`)) return;
    await api.adminDeleteBoardPost(p.id, token);
    load();
  }

  if (error) return <p className="status-msg error">{error}</p>;

  return (
    <div>
      <div className="admin-page-head">
        <h1>Доска</h1>
        <input
          className="admin-search"
          placeholder="Поиск по ID, тексту, городу, автору…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="admin-card admin-table-card">
        <div className="admin-table admin-table-board">
          <div className="admin-table-row admin-table-head admin-table-board">
            <span>ID</span>
            <span>Текст</span>
            <span>Город</span>
            <span>Автор</span>
            <span>Статус</span>
            <span>Осталось</span>
            <span></span>
          </div>
          {loading ? (
            <SkeletonTableRows columns={7} className="admin-table-board" />
          ) : (
            <>
              {posts.map((p) => (
                <div className="admin-table-row admin-table-board" key={p.id}>
                  <span className="admin-subtitle">#{p.id}</span>
                  <span>
                    {p.pinned ? '📌 ' : ''}
                    {p.text}
                    <div className="admin-subtitle">{relativeDate(p.created_at)}</div>
                  </span>
                  <span className="admin-subtitle">{p.city}</span>
                  <span className="admin-subtitle">
                    {p.author_name}
                    {p.whatsapp_phone && <div>{p.whatsapp_phone}</div>}
                    {!p.user_id && <div>гость</div>}
                  </span>
                  <span>
                    {p.hidden ? <span className="badge status-closed">Скрыто</span> : <span className="badge status-open">Видно</span>}
                  </span>
                  <span className="admin-subtitle">{timeLeft(p.expires_at)}</span>
                  <span className="admin-row-buttons">
                    <button className="admin-btn-ghost" onClick={() => togglePinned(p)}>
                      {p.pinned ? 'Открепить' : 'Закрепить'}
                    </button>
                    <button className="admin-btn-ghost" onClick={() => toggleHidden(p)}>
                      {p.hidden ? 'Показать' : 'Скрыть'}
                    </button>
                    <button className="admin-btn-danger" onClick={() => removePost(p)}>
                      Удалить
                    </button>
                  </span>
                </div>
              ))}
              {posts.length === 0 && <p className="status-msg">Ничего не найдено.</p>}
            </>
          )}
        </div>
      </div>
      <Pagination page={meta.page} pages={meta.pages} total={meta.total} onChange={setPage} />
    </div>
  );
}

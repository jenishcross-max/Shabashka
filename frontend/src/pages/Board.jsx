import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useCities } from '../useCities';
import { useMeta } from '../useMeta';
import CityAutocomplete from '../components/CityAutocomplete';

const MAX_TEXT = 500;

// Сколько записке осталось жить. Считаем в минутах: секунды на доске никому не
// нужны, а перерисовка раз в секунду ради них — нет.
function timeLeft(expiresAt) {
  const minutes = Math.floor((new Date(expiresAt) - Date.now()) / 60000);
  if (minutes <= 0) return 'вот-вот пропадёт';
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

export default function Board() {
  const { token, user } = useAuth();
  const cities = useCities();
  useMeta(
    'Доска — срочная подработка в Кыргызстане',
    'Быстрые объявления о работе и подработке. Каждое живёт шесть часов и пропадает само — на доске только актуальное.'
  );

  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [city, setCity] = useState(user?.city || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Пересчитывает «осталось столько-то» без запроса на сервер
  const [, setTick] = useState(0);

  // Профиль приезжает отдельным запросом и почти всегда позже первого кадра, так
  // что города и телефона в начальном состоянии ещё нет. Подставляем их, когда он
  // придёт, но не затираем то, что человек успел набрать сам.
  useEffect(() => {
    if (!user) return;
    setCity((v) => v || user.city || '');
    setPhone((v) => v || user.phone || '');
  }, [user]);

  // Доска — единственная красная страница сайта. Класс вешаем на <body>, а не на
  // свой div: перекрасить нужно и поле за пределами контейнера, и шапку, которая
  // отрисована выше по дереву и до этого компонента не достаёт.
  useEffect(() => {
    document.body.classList.add('board-theme');
    return () => document.body.classList.remove('board-theme');
  }, []);

  const load = useCallback(async () => {
    try {
      const { posts } = await api.boardPosts();
      setPosts(posts);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Минутный таймер обновляет обратный отсчёт, минута из шести — заметная доля,
  // и раз в минуту же дозабираем чужие свежие объявления: доска на то и доска.
  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      load();
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { post } = await api.createBoardPost({ text, city, whatsapp_phone: phone }, token);
      setPosts((list) => [post, ...list]);
      setText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    try {
      await api.deleteBoardPost(id, token);
      setPosts((list) => list.filter((p) => p.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="board">
      <header className="board-head">
        <h1>Доска</h1>
        <p>
          Срочные объявления о работе. Каждое живёт <strong>6 часов</strong> и пропадает само —
          здесь только то, что актуально прямо сейчас.
        </p>
      </header>

      {user ? (
        <form className="board-form" onSubmit={handleSubmit}>
          <textarea
            required
            rows={3}
            maxLength={MAX_TEXT}
            placeholder="Например: нужны два грузчика на сегодня, с 14:00, район Аламедин-1, 1500 сом"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="board-form-row">
            <CityAutocomplete required cities={cities} value={city} onChange={setCity} />
            <input
              type="tel"
              placeholder="WhatsApp (необязательно)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <button type="submit" disabled={submitting}>
              {submitting ? 'Вешаем…' : 'Повесить на доску'}
            </button>
          </div>
          <span className="board-counter">
            {text.length}/{MAX_TEXT}
          </span>
        </form>
      ) : (
        <div className="board-login">
          <p>Чтобы повесить объявление на доску, войдите в аккаунт.</p>
          <Link to="/login">Войти</Link>
          <Link to="/register">Зарегистрироваться</Link>
        </div>
      )}

      {error && <p className="board-error">{error}</p>}

      {loading ? (
        <p className="board-empty">Загружаем доску…</p>
      ) : posts.length === 0 ? (
        <p className="board-empty">Доска пуста. Первое объявление может быть вашим.</p>
      ) : (
        <div className="board-grid">
          {posts.map((post) => (
            <article className="board-note" key={post.id}>
              <p className="board-note-text">{post.text}</p>
              <div className="board-note-meta">
                <span className="board-note-city">{post.city}</span>
                <span className="board-note-timer" title="Через столько объявление пропадёт">
                  ⏳ {timeLeft(post.expires_at)}
                </span>
              </div>
              <div className="board-note-foot">
                <span className="board-note-author">{post.author_name}</span>
                {post.whatsapp_phone && (
                  <a
                    className="board-note-wa"
                    href={`https://wa.me/${post.whatsapp_phone.replace(/[^\d]/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Написать в WhatsApp
                  </a>
                )}
                {user && (user.id === post.user_id || user.role === 'admin') && (
                  <button type="button" className="board-note-del" onClick={() => handleDelete(post.id)}>
                    Снять
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useCities } from '../useCities';
import { useMeta } from '../useMeta';
import CityAutocomplete from '../components/CityAutocomplete';

const MAX_TEXT = 500;

// Метка браузера для тех, кто пишет на доску без аккаунта: по ней сервер считает
// лимит в три объявления и по ней же гость снимает своё. Живёт в localStorage,
// заводится один раз и ничего о человеке не знает.
function guestId() {
  let id = localStorage.getItem('shabashka_board_guest');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `g${Math.random().toString(36).slice(2)}${Date.now()}`;
    localStorage.setItem('shabashka_board_guest', id);
  }
  return id;
}

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

// Ролик в Instagram, пост в Telegram-канале и ссылка в WhatsApp ведут не просто
// на доску, а на конкретную записку — /board#p123. Своей страницы у записки нет
// (она живёт сутки, страница под неё была бы страницей-призраком), поэтому
// вместо перехода подсвечиваем её в общей ленте и подкручиваем к ней.
function targetId() {
  const match = /^#p(\d+)$/.exec(window.location.hash || '');
  return match ? Number(match[1]) : null;
}

export default function Board() {
  const { token, user } = useAuth();
  const cities = useCities();
  useMeta(
    'Доска — срочные объявления в Кыргызстане',
    'Быстрые объявления. Без регистрации, каждое живёт сутки и пропадает само — на доске только актуальное.'
  );

  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Записки, на которые этот человек уже пожаловался — чтобы кнопка не предлагала
  // сделать это второй раз. Список живёт в памяти страницы, и это правильно:
  // никакого смысла помнить его дольше, чем живёт сама записка.
  const [reported, setReported] = useState([]);
  // Пересчитывает «осталось столько-то» без запроса на сервер
  const [, setTick] = useState(0);
  const [target] = useState(targetId);

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

  // Токен и метку браузера отправляем и на чтение: по ним сервер помечает записки,
  // которые можно снять, а сам guest_id наружу не отдаёт.
  const load = useCallback(async () => {
    try {
      const { posts } = await api.boardPosts({ guestId: guestId() }, token);
      setPosts(posts);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

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

  // Подкручиваем к записке из ссылки, когда лента уже отрисована. Хэш браузер
  // сам не найдёт: на первом кадре страницы этого элемента ещё нет.
  useEffect(() => {
    if (!target || loading) return;
    document.getElementById(`p${target}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [target, loading, posts.length]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { post } = await api.createBoardPost(
        { text, city, whatsapp_phone: phone, name, guestId: guestId() },
        token
      );
      setPosts((list) => [post, ...list]);
      setText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    setError('');
    try {
      await api.deleteBoardPost(id, { guestId: guestId() }, token);
      setPosts((list) => list.filter((p) => p.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  // Доска — единственное место на сайте, куда пишут без аккаунта и без проверки
  // на входе, так что кнопка «пожаловаться» нужна здесь больше, чем где-либо.
  // Записка живёт сутки: пока жалоба дойдёт до админки, её может уже не
  // быть — поэтому сервер сохраняет копию текста вместе с жалобой.
  async function handleReport(id) {
    const reason = window.prompt('Что не так с этим объявлением?');
    if (!reason || !reason.trim()) return;
    setError('');
    try {
      await api.reportBoardPost(id, reason);
      setReported((ids) => [...ids, id]);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="board">
      <header className="board-head">
        <h1>
          Доска <span className="board-head-badge">№24</span>
        </h1>
        <p>
          Срочные объявления — <strong>без регистрации</strong>. Каждое живёт{' '}
          <strong>24 часа</strong> и пропадает само: здесь только то, что актуально прямо сейчас.
        </p>
        <p className="board-warning">
          ⚠️ Запрещены спам, реклама, мошенничество, наркотики и всё, что нарушает закон.
          Такие объявления будут удалены, автор — заблокирован. Заметили нарушение — нажмите
          «Пожаловаться» на объявлении.
        </p>
        <p className="board-warning">
          💸 Не переводите деньги вперёд. Доска открыта для всех и объявления никто не
          проверяет — предоплата «за материалы» или «за бронь» почти всегда обман.
        </p>
      </header>

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
          {!user && (
            <input
              className="board-name"
              placeholder="Как вас зовут"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <CityAutocomplete
            required
            className="board-city"
            placeholder="Город"
            cities={cities}
            value={city}
            onChange={setCity}
          />
          <input
            type="tel"
            required={!user}
            placeholder={user ? 'WhatsApp (необязательно)' : 'WhatsApp'}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Вешаем…' : 'Повесить на доску'}
          </button>
        </div>
        <span className="board-counter">
          {text.length}/{MAX_TEXT} · до 3 объявлений
          {user ? '' : '. Есть аккаунт? '}
          {!user && (
            <Link to="/login" className="board-counter-link">
              войдите
            </Link>
          )}
        </span>
      </form>

      {error && <p className="board-error">{error}</p>}

      {/* Пришли по ссылке из ролика или канала, а объявление уже пропало — об этом
          лучше сказать прямо, иначе человек ищет глазами то, чего нет. */}
      {target && !loading && !posts.some((p) => p.id === target) && (
        <p className="board-gone">
          Это объявление уже пропало с доски — прошло больше суток. Ниже то, что
          актуально сейчас.
        </p>
      )}

      {loading ? (
        <p className="board-empty">Загружаем доску…</p>
      ) : posts.length === 0 ? (
        <p className="board-empty">Доска пуста. Первое объявление может быть вашим.</p>
      ) : (
        <div className="board-grid">
          {posts.map((post) => (
            <article
              className={`board-note${post.id === target ? ' board-note-target' : ''}`}
              id={`p${post.id}`}
              key={post.id}
            >
              <p className="board-note-text">{post.text}</p>
              {!!post.is_imported && (
                <p className="board-note-imported" title="Автора этого объявления мы не проверяли">
                  ℹ️ Из открытых чатов
                </p>
              )}
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
                {post.mine ? (
                  <button type="button" className="board-note-del" onClick={() => handleDelete(post.id)}>
                    Снять
                  </button>
                ) : reported.includes(post.id) ? (
                  <span className="board-note-reported">Жалоба отправлена</span>
                ) : (
                  <button
                    type="button"
                    className="board-note-report"
                    title="Пожаловаться на объявление"
                    onClick={() => handleReport(post.id)}
                  >
                    ⚑ Пожаловаться
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

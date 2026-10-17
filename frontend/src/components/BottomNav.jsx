import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useUnread } from '../context/UnreadContext';
import { POST_ITEMS, profileItems } from './NavMenus';
import Sheet from './Sheet';

// Значки панели — простые контуры одной толщины: эмодзи на разных телефонах
// рисуются по-разному, а здесь они должны читаться как одна система.
const ICONS = {
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z',
  work: 'M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M4.5 7h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1ZM3.5 12.5h17',
  ads: 'M3.5 4.5v6.3c0 .4.2.8.4 1.1l8.2 8.2a1.5 1.5 0 0 0 2.1 0l5.7-5.7a1.5 1.5 0 0 0 0-2.1l-8.2-8.2a1.5 1.5 0 0 0-1.1-.4H4.5a1 1 0 0 0-1 1ZM8 8h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c.6-3.4 3.4-5.5 7-5.5s6.4 2.1 7 5.5',
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const WORK_PATHS = ['/orders', '/vacancies', '/tasks'];
const PROFILE_PATHS = ['/messages', '/favorites', '/my-', '/login', '/register', '/admin'];

// Нижняя панель на телефоне — вместо бургера: пять кнопок под большим пальцем,
// как в приложениях. Работа, объявления и «Разместить» — по одному касанию,
// личное — в панели «Профиль». На компьютере скрыта (см. index.css).
export default function BottomNav() {
  const { user, logout } = useAuth();
  const { unread, newOffers } = useUnread();
  const location = useLocation();
  const navigate = useNavigate();
  const [sheet, setSheet] = useState(null);
  const close = useCallback(() => setSheet(null), []);

  useEffect(close, [location.pathname, location.search, close]);

  const path = location.pathname;
  const isWork = WORK_PATHS.some((p) => path.startsWith(p)) && !path.endsWith('/new');
  const isProfile = PROFILE_PATHS.some((p) => path.startsWith(p));
  const item = (active) => `bottom-nav-item${active ? ' active' : ''}`;

  const profile = user
    ? [{ to: '/messages', label: 'Сообщения', badge: unread }, ...profileItems(user, newOffers)]
    : profileItems(null);

  return (
    <>
      <nav className="bottom-nav" aria-label="Навигация">
        <NavLink to="/" end className={({ isActive }) => item(isActive)}>
          <Icon name="home" />
          <span>Главная</span>
        </NavLink>
        <Link to="/orders" className={item(isWork)}>
          <Icon name="work" />
          <span>Работа</span>
        </Link>
        <button type="button" className="bottom-nav-post" aria-label="Разместить" onClick={() => setSheet('post')}>
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
        <NavLink to="/ads" className={({ isActive }) => item(isActive)}>
          <Icon name="ads" />
          <span>Объявления</span>
        </NavLink>
        <button type="button" className={item(isProfile)} onClick={() => setSheet('profile')}>
          <Icon name="user" />
          <span>Профиль</span>
          {(unread > 0 || newOffers > 0) && <span className="bottom-nav-dot" aria-label="Есть новое" />}
        </button>
      </nav>

      <Sheet open={sheet === 'post'} onClose={close} title="Что разместить?">
        <div className="sheet-list">
          {POST_ITEMS.map((p) => (
            <Link key={p.to} to={p.to}>
              <span>
                {p.label}
                <span className="sheet-hint">{p.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      </Sheet>

      <Sheet open={sheet === 'profile'} onClose={close} title={user ? user.name : 'Профиль'}>
        <div className="sheet-list">
          {profile.map((p) => (
            <Link key={p.to} to={p.to}>
              {p.label}
              {p.badge > 0 && <span className="nav-unread-badge">{p.badge}</span>}
            </Link>
          ))}
          {user && (
            <button
              type="button"
              className="sheet-logout"
              onClick={() => {
                logout();
                navigate('/');
              }}
            >
              Выйти
            </button>
          )}
        </div>
      </Sheet>
    </>
  );
}

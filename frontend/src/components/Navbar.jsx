import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useUnread } from '../context/UnreadContext';
import Logo from './Logo';
import FormatIcon from './FormatIcon';
import { PostMenu, ProfileMenu, useDropdown } from './NavMenus';

function navClass({ isActive }) {
  return `muted${isActive ? ' active' : ''}`;
}

function OrdersMenu() {
  const location = useLocation();
  const { open, setOpen, ref } = useDropdown();

  const isOrdersSection = location.pathname.startsWith('/orders');
  const workFormat = new URLSearchParams(location.search).get('workFormat');

  return (
    <div className="nav-dropdown" ref={ref}>
      <button
        type="button"
        className={`nav-dropdown-trigger${isOrdersSection ? ' active' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        Подработка ▾
      </button>
      {open && (
        <div className="nav-dropdown-menu">
          <Link
            to="/orders"
            className={isOrdersSection && !workFormat ? 'active' : ''}
            onClick={() => setOpen(false)}
          >
            Все заказы
          </Link>
          <Link
            to="/orders?workFormat=offline"
            className={workFormat === 'offline' ? 'active' : ''}
            onClick={() => setOpen(false)}
          >
            <FormatIcon name="offline" size={15} /> Только офлайн
          </Link>
          <Link
            to="/orders?workFormat=online"
            className={workFormat === 'online' ? 'active' : ''}
            onClick={() => setOpen(false)}
          >
            <FormatIcon name="online" size={15} /> Только онлайн
          </Link>
        </div>
      )}
    </div>
  );
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { unread, newOffers } = useUnread();

  function handleLogout() {
    logout();
    navigate('/');
  }

  // Слева — разделы, справа — личное и «Разместить». Всё в одну строку: раньше
  // в шапке было до двенадцати пунктов, и на ноутбуке она переносилась на две.
  // На телефоне остаётся только логотип — навигация там в нижней панели
  // (см. BottomNav.jsx).
  return (
    <header className="navbar">
      <Link to="/" className="brand">
        <Logo />
      </Link>
      <nav className="nav-sections" aria-label="Разделы">
        <NavLink to="/tasks" className={navClass}>
          Биржа
          {newOffers > 0 && (
            <span className="nav-unread-badge" title="Новые отклики на ваши задачи">
              {newOffers}
            </span>
          )}
        </NavLink>
        <OrdersMenu />
        <NavLink to="/vacancies" className={navClass}>
          Вакансии
        </NavLink>
        <NavLink to="/ads" className={navClass}>
          Объявления
        </NavLink>
      </nav>
      <div className="nav-actions">
        {user && (
          <NavLink
            to="/messages"
            className={({ isActive }) => `nav-icon-link${isActive ? ' active' : ''}`}
            aria-label={unread > 0 ? `Сообщения, непрочитанных: ${unread}` : 'Сообщения'}
            title="Сообщения"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.2c-.5.4-1.3 0-1.3-.6V17A2.5 2.5 0 0 1 4 14.5v-8Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
              />
            </svg>
            {unread > 0 && <span className="nav-unread-badge nav-icon-badge">{unread}</span>}
          </NavLink>
        )}
        <PostMenu />
        {user ? (
          <ProfileMenu user={user} newOffers={newOffers} onLogout={handleLogout} />
        ) : (
          <NavLink to="/login" className="nav-login">
            Войти
          </NavLink>
        )}
      </div>
    </header>
  );
}

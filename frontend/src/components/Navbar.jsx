import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useUnread } from '../context/UnreadContext';
import Logo from './Logo';
import FormatIcon from './FormatIcon';

function navClass({ isActive }) {
  return `muted${isActive ? ' active' : ''}`;
}

function OrdersMenu() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  const isOrdersSection = location.pathname.startsWith('/orders');
  const workFormat = new URLSearchParams(location.search).get('workFormat');

  return (
    <div className="nav-dropdown" ref={ref}>
      <button
        type="button"
        className={`nav-dropdown-trigger${isOrdersSection ? ' active' : ''}`}
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
            Все объявления
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
  const location = useLocation();
  const { unread } = useUnread();
  const [menuOpen, setMenuOpen] = useState(false);

  // На узких экранах пунктов слишком много, чтобы держать их развёрнутыми:
  // прячем за кнопкой и закрываем после каждого перехода.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <header className="navbar">
      <Link to="/" className="brand">
        <Logo />
      </Link>
      <button
        type="button"
        className="nav-burger"
        aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {menuOpen ? '✕' : '☰'}
        {!menuOpen && unread > 0 && <span className="nav-burger-dot" />}
      </button>
      <nav className={`nav-links${menuOpen ? ' open' : ''}`}>
        <OrdersMenu />
        <NavLink to="/vacancies" className={navClass}>
          Вакансии
        </NavLink>
        <NavLink to="/board" className={navClass}>
          Доска <span className="nav-board-badge">№6</span>
        </NavLink>
        <NavLink to="/favorites" className={navClass}>
          ★ Избранное
        </NavLink>
        {user ? (
          <>
            <NavLink to="/messages" className={navClass}>
              Сообщения
              {unread > 0 && <span className="nav-unread-badge">{unread}</span>}
            </NavLink>
            <NavLink to="/my-orders" className={navClass}>
              Мои объявления
            </NavLink>
            {user.role === 'admin' && (
              <NavLink to="/admin" className={navClass}>
                Админ-панель
              </NavLink>
            )}
            <span className="nav-user">{user.name}</span>
            <button className="link-btn" onClick={handleLogout}>
              Выйти
            </button>
            <Link to="/orders/new" className="cta">
              + Разместить заказ
            </Link>
          </>
        ) : (
          <>
            <NavLink to="/login" className={navClass}>
              Войти
            </NavLink>
            <Link to="/register" className="cta">
              + Разместить заказ
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}

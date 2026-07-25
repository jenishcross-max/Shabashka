import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Logo from './Logo';

function navClass({ isActive }) {
  return `muted${isActive ? ' active' : ''}`;
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <header className="navbar">
      <Link to="/" className="brand">
        <Logo />
      </Link>
      <nav className="nav-links">
        <NavLink to="/orders" className={({ isActive }) => (isActive ? 'active' : '')}>
          Все заказы
        </NavLink>
        <NavLink to="/vacancies" className={navClass}>
          Вакансии
        </NavLink>
        <NavLink to="/favorites" className={navClass}>
          ★ Избранное
        </NavLink>
        {user ? (
          <>
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

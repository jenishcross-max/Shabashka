import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
        <span className="brand-mark">Ш</span>
        Шабашка<span>.kg</span>
      </Link>
      <nav className="nav-links">
        <Link to="/orders">Все заказы</Link>
        <Link to="/favorites" className="muted">
          ★ Избранное
        </Link>
        <Link to="/#how" className="muted">
          Как это работает
        </Link>
        {user ? (
          <>
            <Link to="/my-orders" className="muted">
              Мои заказы
            </Link>
            {user.role === 'admin' && (
              <Link to="/admin" className="muted">
                Админ-панель
              </Link>
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
            <Link to="/login" className="muted">
              Войти
            </Link>
            <Link to="/register" className="cta">
              + Разместить заказ
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}

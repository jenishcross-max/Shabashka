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
        Шабашка <span>КГ</span>
      </Link>
      <nav className="nav-links">
        <Link to="/">Все заказы</Link>
        {user ? (
          <>
            <Link to="/orders/new">+ Разместить заказ</Link>
            <Link to="/my-orders">Мои заказы</Link>
            <span className="nav-user">{user.name}</span>
            <button className="link-btn" onClick={handleLogout}>
              Выйти
            </button>
          </>
        ) : (
          <>
            <Link to="/login">Войти</Link>
            <Link to="/register" className="cta">
              Разместить заказ
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}

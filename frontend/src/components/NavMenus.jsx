import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

// Что можно разместить на сайте. Один список на шапку и на нижнюю панель
// телефона: раньше в шапке был только «Разместить заказ», и вакансию или
// объявление человек искал по разделам.
export const POST_ITEMS = [
  { to: '/orders/new', label: 'Заказ', hint: 'разовая работа, мастер на час' },
  { to: '/tasks/new', label: 'Задачу на бирже', hint: 'исполнители сами предложат цену' },
  { to: '/vacancies/new', label: 'Вакансию', hint: 'постоянная работа в штат' },
  { to: '/ads/new', label: 'Объявление', hint: 'сдам, продам, услуги' },
];

// Личное — тоже одним списком для меню профиля и панели «Профиль».
export function profileItems(user, newOffers = 0) {
  if (!user) {
    return [
      { to: '/login', label: 'Войти' },
      { to: '/register', label: 'Регистрация' },
      { to: '/favorites', label: '★ Избранное' },
    ];
  }
  return [
    { to: '/favorites', label: '★ Избранное' },
    { to: '/my-orders', label: 'Мои публикации', badge: newOffers },
    ...(user.role === 'admin' ? [{ to: '/admin', label: 'Админ-панель' }] : []),
  ];
}

// Выпадающее меню: закрывается по клику мимо, по Esc и после перехода.
export function useDropdown() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onPointer(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  return { open, setOpen, ref };
}

export function PostMenu() {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div className="nav-dropdown" ref={ref}>
      <button
        type="button"
        className="cta nav-post-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        + Разместить
      </button>
      {open && (
        <div className="nav-dropdown-menu nav-dropdown-right nav-post-menu" role="menu">
          {POST_ITEMS.map((item) => (
            <Link key={item.to} to={item.to} role="menuitem">
              <span className="nav-post-label">{item.label}</span>
              <span className="nav-post-hint">{item.hint}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Первая буква имени в кружке — чтобы меню профиля узнавалось без подписи.
export function Initial({ name }) {
  return <span className="nav-avatar">{String(name || '?').trim().charAt(0).toUpperCase()}</span>;
}

export function ProfileMenu({ user, newOffers, onLogout }) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div className="nav-dropdown" ref={ref}>
      <button
        type="button"
        className="nav-profile-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <Initial name={user.name} />
        <span className="nav-profile-name">{user.name}</span>
        {newOffers > 0 && <span className="nav-dot" aria-label="Новые отклики" />}
      </button>
      {open && (
        <div className="nav-dropdown-menu nav-dropdown-right" role="menu">
          {profileItems(user, newOffers).map((item) => (
            <Link key={item.to} to={item.to} role="menuitem">
              {item.label}
              {item.badge > 0 && <span className="nav-unread-badge">{item.badge}</span>}
            </Link>
          ))}
          <button type="button" className="nav-menu-logout" role="menuitem" onClick={onLogout}>
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}

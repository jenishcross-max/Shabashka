import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import Logo from '../components/Logo';

export default function AdminLayout() {
  const { user, token } = useAuth();
  const [openReports, setOpenReports] = useState(0);

  useEffect(() => {
    api.adminStats(token).then((s) => setOpenReports(s.openReports)).catch(() => {});
  }, [token]);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <Logo size="sm" onDark />
        </div>
        <NavLink to="/admin" end className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
          📊 Обзор
        </NavLink>
        <NavLink to="/admin/users" className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
          👥 Пользователи
        </NavLink>
        <NavLink to="/admin/orders" className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
          📋 Заказы
        </NavLink>
        <NavLink to="/admin/vacancies" className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
          💼 Вакансии
        </NavLink>
        <NavLink to="/admin/reports" className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
          <span>⚑ Жалобы</span>
          {openReports > 0 && <span className="admin-nav-badge">{openReports}</span>}
        </NavLink>
        <NavLink
          to="/admin/categories"
          className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}
        >
          🏷 Категории
        </NavLink>
        <div className="admin-sidebar-footer">
          Админ · {user?.name}
          <br />
          <NavLink to="/" className="admin-back-link">
            ← На сайт
          </NavLink>
        </div>
      </aside>
      <div className="admin-main">
        <Outlet />
      </div>
    </div>
  );
}

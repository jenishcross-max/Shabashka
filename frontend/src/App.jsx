import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import ProtectedAdminRoute from './components/ProtectedAdminRoute';
import Home from './pages/Home';
import OrderDetail from './pages/OrderDetail';
import Login from './pages/Login';
import Register from './pages/Register';
import NewOrder from './pages/NewOrder';
import EditOrder from './pages/EditOrder';
import MyOrders from './pages/MyOrders';
import Favorites from './pages/Favorites';

// Код админки грузится отдельным чанком только тем, кто реально заходит в /admin —
// обычные посетители и исполнители его не скачивают.
const AdminLayout = lazy(() => import('./admin/AdminLayout'));
const AdminOverview = lazy(() => import('./admin/AdminOverview'));
const AdminUsers = lazy(() => import('./admin/AdminUsers'));
const AdminOrders = lazy(() => import('./admin/AdminOrders'));
const AdminReports = lazy(() => import('./admin/AdminReports'));
const AdminCategories = lazy(() => import('./admin/AdminCategories'));

function PublicSite() {
  return (
    <>
      <Navbar />
      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/favorites" element={<Favorites />} />
          <Route
            path="/orders/new"
            element={
              <ProtectedRoute>
                <NewOrder />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders/:id/edit"
            element={
              <ProtectedRoute>
                <EditOrder />
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-orders"
            element={
              <ProtectedRoute>
                <MyOrders />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<p className="status-msg">Страница не найдена</p>} />
        </Routes>
      </main>
      <footer className="footer">
        Шабашка.kg — доска объявлений для поиска подработки и мастеров в Кыргызстане
      </footer>
    </>
  );
}

export default function App() {
  return (
    <Suspense fallback={<p className="status-msg">Загрузка…</p>}>
      <Routes>
        <Route
          path="/admin/*"
          element={
            <ProtectedAdminRoute>
              <AdminLayout />
            </ProtectedAdminRoute>
          }
        >
          <Route index element={<AdminOverview />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="categories" element={<AdminCategories />} />
        </Route>
        <Route path="/*" element={<PublicSite />} />
      </Routes>
    </Suspense>
  );
}

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { SkeletonPage } from './Skeleton';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <SkeletonPage />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  return children;
}

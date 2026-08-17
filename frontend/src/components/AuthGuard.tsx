import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useIsAuthenticated } from '../store/auth';
import { useDemoModeStore } from '../store/demoMode';

/**
 * Route guard. Sends unauthenticated visitors to `/login` unless they've
 * explicitly opted into demo mode. The original location is preserved via
 * router state so the login page can bounce the user back afterwards.
 */
export function AuthGuard() {
  const isAuthed = useIsAuthenticated();
  const isDemo = useDemoModeStore((s) => s.enabled);
  const location = useLocation();

  if (!isAuthed && !isDemo) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

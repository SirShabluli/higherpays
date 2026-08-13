import { NavLink, Outlet } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { useCan } from '../hooks/usePermission';
import { ROLE_HINT } from '../rbac/permissions';
import type { Role, Permission } from '../types';

interface NavItem {
  path: string;
  label: string;
  perm: Permission;
  icon: string;
}

const OPERATE: NavItem[] = [
  { path: '/payments', label: 'Payments', perm: 'payments.view',
    icon: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>' },
  { path: '/links', label: 'Payment Links', perm: 'links.view',
    icon: '<path d="M9 15l6-6"/><path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1"/><path d="M13 18l-1 1a4 4 0 0 1-6-6l1-1"/>' },
  { path: '/analytics', label: 'Analytics', perm: 'analytics.view',
    icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
  { path: '/goals', label: 'Team Goals', perm: 'analytics.view',
    icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>' },
  { path: '/compare', label: 'Compare', perm: 'commissions.view',
    icon: '<path d="M18 20V10M12 20V4M6 20v-6"/><path d="M3 20h18"/>' },
  { path: '/payouts', label: 'Payouts', perm: 'commissions.view',
    icon: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>' },
];

const MANAGE: NavItem[] = [
  { path: '/creators', label: 'Creators', perm: 'creators.view',
    icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>' },
  { path: '/customers', label: 'Customers', perm: 'customers.view',
    icon: '<circle cx="12" cy="7" r="4"/><path d="M5 21v-1a7 7 0 0 1 14 0v1"/>' },
];

const ADMIN: NavItem[] = [
  { path: '/platform', label: 'Platform BO', perm: 'platform.view',
    icon: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/>' },
  { path: '/workspaces', label: 'Workspaces', perm: 'workspaces.view',
    icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
  { path: '/team', label: 'Team', perm: 'team.view',
    icon: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="8" r="2.4"/><path d="M17 14c2.5 0 4 2 4 4.5"/>' },
  { path: '/settings', label: 'Settings', perm: 'settings.view',
    icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>' },
];

const ALL_ROLES: Role[] = ['owner', 'admin', 'manager', 'analyst', 'chatter', 'creator', 'super_admin'];

function NavSection({ label, items }: { label: string; items: NavItem[] }) {
  const can = useCan();
  const visibleItems = items.filter(item => can(item.perm));
  if (visibleItems.length === 0) return null;

  return (
    <>
      <div className="nav-lbl">{label}</div>
      {visibleItems.map(item => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) => `navitem${isActive ? ' active' : ''}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
            dangerouslySetInnerHTML={{ __html: item.icon }} />
          {item.label}
        </NavLink>
      ))}
    </>
  );
}

export default function Layout() {
  const role = useAppStore(s => s.role);
  const setRole = useAppStore(s => s.setRole);
  const brand = useAppStore(s => s.brand);

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <div className="mark">{brand.initial}</div>
          <span className="brand-sep" aria-hidden="true" />
          <div><h1>HigherPays</h1></div>
        </div>

        <nav>
          <NavSection label="Operate" items={OPERATE} />
          <NavSection label="Manage" items={MANAGE} />
          <NavSection label="Administer" items={ADMIN} />
        </nav>

        <div className="side-foot">
          <div className="roleswitch">
            <label>Preview as role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as Role)}
            >
              {ALL_ROLES.map(r => (
                <option key={r} value={r}>
                  {r === 'super_admin' ? 'Super Admin' : r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
            <div className="hint">{ROLE_HINT[role]}</div>
          </div>
        </div>
      </aside>

      <main>
        <Outlet />
      </main>
    </div>
  );
}

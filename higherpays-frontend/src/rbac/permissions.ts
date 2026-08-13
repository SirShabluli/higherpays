import type { Role, Permission, Transaction } from '../types';

export const CAPS: Array<[string, Permission]> = [
  ['View payments', 'payments.view'], ['Export reports', 'payments.export'],
  ['View payment links', 'links.view'], ['Create payment links', 'links.create'],
  ['View analytics', 'analytics.view'],
  ['View workspaces', 'workspaces.view'], ['Create workspaces', 'workspaces.create'],
  ['View creators', 'creators.view'], ['Manage creators', 'creators.manage'],
  ['View customers', 'customers.view'], ['Manage customers', 'customers.manage'], ['Export customers', 'customers.export'],
  ['View sales', 'sales.view'],
  ['View commissions', 'commissions.view'], ['Manage commissions', 'commissions.manage'],
  ['View team', 'team.view'], ['Manage team', 'team.manage'],
  ['View settings', 'settings.view'], ['Edit settings', 'settings.edit'], ['Danger zone', 'settings.danger'],
  ['Platform back office', 'platform.view'],
];

export const ROLE_HINT: Record<Role, string> = {
  owner: 'Full access, including financials and danger-zone actions.',
  admin: 'Everything except danger-zone settings.',
  manager: 'Runs assigned creators, sees team performance.',
  analyst: 'Read-only across the whole workspace.',
  chatter: 'Create links, see assigned creators/customers/own sales.',
  creator: 'Own dashboard and earnings only.',
  super_admin: 'HigherPays operator \u2013 cross-workspace back office.',
};

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ['payments.view','payments.export','links.view','links.create','analytics.view','workspaces.view','workspaces.create','creators.view','creators.manage','customers.view','customers.manage','customers.export','sales.view','commissions.view','commissions.manage','team.view','team.manage','settings.view','settings.edit','settings.danger'],
  admin: ['payments.view','payments.export','links.view','links.create','analytics.view','workspaces.view','workspaces.create','creators.view','creators.manage','customers.view','customers.manage','customers.export','sales.view','commissions.view','commissions.manage','team.view','team.manage','settings.view','settings.edit'],
  manager: ['payments.view','links.view','links.create','analytics.view','workspaces.view','creators.view','creators.manage','customers.view','sales.view','commissions.view','team.view','settings.view'],
  analyst: ['payments.view','payments.export','links.view','analytics.view','workspaces.view','creators.view','customers.view','sales.view','commissions.view','settings.view'],
  chatter: ['payments.view','links.view','links.create','analytics.view','creators.view','customers.view','sales.view'],
  creator: ['payments.view','analytics.view'],
  super_admin: ['payments.view','payments.export','links.view','links.create','analytics.view','workspaces.view','workspaces.create','creators.view','creators.manage','customers.view','customers.manage','customers.export','sales.view','commissions.view','commissions.manage','team.view','team.manage','settings.view','settings.edit','settings.danger','platform.view'],
};

export const SCOPED_ROLES: Partial<Record<Role, string>> = {
  chatter: 'chatter',
  creator: 'creator',
};

export function can(
  perm: Permission,
  role: Role,
  roles: Record<string, Permission[]>,
): boolean {
  return (roles[role] || []).includes(perm);
}

export function makeCan(role: Role, roles: Record<string, Permission[]>): (perm: Permission) => boolean {
  return (perm: Permission) => (roles[role] || []).includes(perm);
}

export interface Identity {
  field: 'chatter' | 'creator';
  name: string;
}

export function currentIdentity(
  role: Role,
  identityOverride?: { chatter?: string; creator?: string },
): Identity | null {
  if (role === 'chatter') return { field: 'chatter', name: identityOverride?.chatter || 'Sam Ortiz' };
  if (role === 'creator') return { field: 'creator', name: identityOverride?.creator || 'Ava Lane' };
  return null;
}

export function scopeTx<T extends Pick<Transaction, 'chatter' | 'creator'>>(
  list: T[],
  role: Role,
  identityOverride?: { chatter?: string; creator?: string },
): T[] {
  const id = currentIdentity(role, identityOverride);
  return id ? list.filter(t => t[id.field] === id.name) : list;
}

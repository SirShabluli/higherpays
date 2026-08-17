/**
 * Shared API contract types. Each endpoint module below reuses these.
 *
 * These live under `api/` (not `types/`) so it's obvious which types are
 * *what the backend actually sends* vs. UI-facing types derived in hooks.
 */

export type Role =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'analyst'
  | 'chatter'
  | 'creator'
  | 'super_admin';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  twoFactorEnabled: boolean;
}

export interface AuthWorkspace {
  id: string;
  name: string;
  role: Role;
  status?: string;
  currency?: string;
  organization?: string;
}

export interface LoginSuccess {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  workspaces: AuthWorkspace[];
}

export interface TwoFactorRequired {
  twoFactorRequired: true;
}

export type LoginResponse = LoginSuccess | TwoFactorRequired;

export function isTwoFactorRequired(r: LoginResponse): r is TwoFactorRequired {
  return 'twoFactorRequired' in r && r.twoFactorRequired === true;
}

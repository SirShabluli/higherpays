import { api } from '../http';
import type { AuthUser, AuthWorkspace, LoginResponse } from '../types';

export const authApi = {
  login(email: string, password: string, totp?: string) {
    return api.post<LoginResponse>(
      '/auth/login',
      { email, password, ...(totp ? { totp } : {}) },
      { skipWorkspace: true },
    );
  },

  refresh(refreshToken: string) {
    return api.post<{ accessToken: string; refreshToken: string }>(
      '/auth/refresh',
      { refreshToken },
      { skipRefresh: true, skipWorkspace: true },
    );
  },

  logout(refreshToken: string | null) {
    return api.post<void>(
      '/auth/logout',
      refreshToken ? { refreshToken } : {},
      { skipWorkspace: true },
    );
  },

  me() {
    return api.get<{ user: AuthUser; workspaces: AuthWorkspace[] }>(
      '/auth/me',
      { skipWorkspace: true },
    );
  },

  myWorkspaces() {
    return api.get<{ workspaces: AuthWorkspace[] }>(
      '/auth/me/workspaces',
      { skipWorkspace: true },
    );
  },
};

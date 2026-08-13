import { useAppStore } from '../store/appStore';

class ApiClient {
  base = '';
  workspaceId: string | null = null;

  private get token() { return useAppStore.getState().token; }
  private get refreshTokenValue() { return useAppStore.getState().refreshToken; }
  get mode() { return useAppStore.getState().mode; }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = 'Bearer ' + this.token;
    if (this.workspaceId) h['X-Workspace-Id'] = this.workspaceId;
    return h;
  }

  async req(path: string, opts: RequestInit = {}): Promise<unknown> {
    const res = await fetch(this.base + path, {
      ...opts,
      headers: { ...this.headers(), ...(opts.headers as Record<string, string> || {}) },
    });

    if (res.status === 401 && this.refreshTokenValue && !path.includes('/auth/refresh')) {
      const ok = await this.doRefresh();
      if (ok) return this.req(path, opts);
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((body as { error?: string }).error || 'HTTP ' + res.status);
      (err as unknown as Record<string, unknown>).status = res.status;
      (err as unknown as Record<string, unknown>).body = body;
      throw err;
    }
    return body;
  }

  async doRefresh(): Promise<boolean> {
    try {
      const res = await fetch(this.base + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshTokenValue }),
      });
      if (!res.ok) return false;
      const data = await res.json() as { accessToken: string; refreshToken: string };
      useAppStore.getState().setAuth(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  post(path: string, body: unknown) {
    return this.req(path, { method: 'POST', body: JSON.stringify(body) });
  }

  put(path: string, body: unknown) {
    return this.req(path, { method: 'PUT', body: JSON.stringify(body) });
  }

  patch(path: string, body: unknown) {
    return this.req(path, { method: 'PATCH', body: JSON.stringify(body) });
  }

  del(path: string) {
    return this.req(path, { method: 'DELETE' });
  }
}

export const API = new ApiClient();

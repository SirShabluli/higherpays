/**
 * Minimal fetch wrapper for the HigherPays API.
 *
 * Design goals:
 * - Plain functions, no classes. Easier to tree-shake, mock, and test.
 * - The auth token and the active workspace id are pulled from the auth /
 *   session stores at call time, so callers never have to thread them through.
 * - Failed requests throw a structured `HttpError`. The auth store subscribes
 *   to it and clears itself on 401 once a refresh has been attempted.
 */

import { useAuthStore } from '../store/auth';
import { useSessionStore } from '../store/session';

const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

interface HttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip the automatic refresh-on-401 dance. Used by /auth/refresh itself. */
  skipRefresh?: boolean;
  /** Skip adding X-Workspace-Id. Used by workspace-agnostic endpoints. */
  skipWorkspace?: boolean;
}

/** Low-level request. Prefer the `api` helper below. */
async function request<T>(path: string, opts: HttpOptions = {}): Promise<T> {
  const auth = useAuthStore.getState();
  const workspaceId = useSessionStore.getState().activeWorkspaceId;

  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth.accessToken) headers['Authorization'] = `Bearer ${auth.accessToken}`;
  if (workspaceId && !opts.skipWorkspace) headers['X-Workspace-Id'] = workspaceId;

  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
    credentials: 'include',
  });

  // Try to parse JSON regardless; empty bodies become {}.
  const raw = await res.text();
  const parsed: unknown = raw ? safeJson(raw) : {};

  if (res.status === 401 && !opts.skipRefresh && auth.refreshToken) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { ...opts, skipRefresh: true });
  }

  if (!res.ok) {
    const message =
      (isObject(parsed) && typeof parsed.error === 'string' && parsed.error) ||
      `HTTP ${res.status}`;
    throw new HttpError(res.status, message, parsed);
  }

  return parsed as T;
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return { raw: s }; }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return false;

  refreshInFlight = (async () => {
    try {
      const data = await request<{ accessToken: string; refreshToken: string }>(
        '/auth/refresh',
        {
          method: 'POST',
          body: { refreshToken },
          skipRefresh: true,
          skipWorkspace: true,
        },
      );
      useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      useAuthStore.getState().clear();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export const api = {
  get: <T>(path: string, opts?: HttpOptions) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: HttpOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: HttpOptions) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: HttpOptions) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  del: <T>(path: string, opts?: HttpOptions) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
};

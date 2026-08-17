import { useSessionStore } from '../store/session';

/**
 * Build a `/workspaces/:wid/...` URL from the active workspace id.
 *
 * Reads from the session store rather than requiring every caller to thread
 * the id through. Throws if no workspace is active — the API isn't callable
 * in that state, and a clear crash is nicer than a mysterious 404.
 */
export function workspacePath(suffix: string): string {
  const wid = useSessionStore.getState().activeWorkspaceId;
  if (!wid) {
    throw new Error(
      'No active workspace. The frontend must have a workspace selected before ' +
      'calling workspace-scoped endpoints.',
    );
  }
  const clean = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `/workspaces/${wid}${clean}`;
}

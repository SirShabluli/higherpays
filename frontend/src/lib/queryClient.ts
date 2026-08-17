import { QueryClient } from '@tanstack/react-query';
import { HttpError } from '../api/http';

/**
 * Single shared React Query client.
 *
 * - Never retry 4xx: user error, no point pounding the server.
 * - 30 s default stale time — most CRUD lists don't need to refetch on every
 *   mount, and we invalidate explicitly on mutation.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../lib/queryClient';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * Cross-cutting providers wrapped around the whole app. Keep this list short —
 * one place, one import, easy to see in dev what's turned on.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

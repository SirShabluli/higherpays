import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}

/**
 * Consistent zero-data placeholder. Prefer this over inline "No X found"
 * messages so tables and cards read the same across pages.
 */
export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
      <div style={{ fontSize: 15, marginBottom: 6, color: 'var(--text)' }}>{title}</div>
      {hint ? <div style={{ fontSize: 13.5 }}>{hint}</div> : null}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}

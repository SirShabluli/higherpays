import type { ReactNode } from 'react';

interface DetailRowProps {
  label: string;
  children: ReactNode;
}

/** Two-column label→value row used inside modals for entity details. */
export function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div
      style={{
        display: 'flex', justifyContent: 'space-between', gap: 16,
        padding: '9px 0', borderBottom: '1px solid rgba(30,43,68,.5)',
      }}
    >
      <span style={{ color: 'var(--muted)', fontSize: '14.3px' }}>{label}</span>
      <span style={{ fontSize: '14.3px', textAlign: 'right' }}>{children}</span>
    </div>
  );
}

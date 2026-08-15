import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  color?: string;
  up?: boolean;
}

/** One data point (KPI) with a subtitle. Used in `StatGrid` for the dashboard rows. */
export function StatCard({ label, value, sub, color, up }: StatCardProps) {
  return (
    <div className="card stat">
      <div className="lbl">{label}</div>
      <div className="val" style={color ? { color } : undefined}>{value}</div>
      {sub ? <div className={`sub${up ? ' up' : ''}`}>{sub}</div> : null}
    </div>
  );
}

interface StatGridProps {
  children: ReactNode;
}

export function StatGrid({ children }: StatGridProps) {
  return <div className="stats">{children}</div>;
}

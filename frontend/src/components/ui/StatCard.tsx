import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /**
   * @deprecated Prefer `<Money direction="in" | "out" />` in `value`.
   * Left in for pages we haven't migrated yet.
   */
  color?: string;
  /** Marks the sub-line as a positive delta ("up 12%"). */
  up?: boolean;
}

/**
 * One number in the KPI strip. Rendered as a border-less cell inside a
 * shared `.stats` container so a row of stats reads as a single band, the
 * way a ledger prints headline totals.
 */
export function StatCard({ label, value, sub, color, up }: StatCardProps) {
  return (
    <div className="stat">
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

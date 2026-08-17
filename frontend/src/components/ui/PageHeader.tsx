import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/** Standard `<h2>` + tagline + right-side action buttons row for every page. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="pagehead">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div style={{ display: 'flex', gap: 8 }}>{actions}</div> : null}
    </div>
  );
}

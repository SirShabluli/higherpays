import type { ReactNode } from 'react';

interface FilterBarProps {
  children: ReactNode;
}

/**
 * Row of controls (selects, search boxes, buttons) above a table. Wraps the
 * existing `.filters` styles so pages don't hand-roll the flex layout.
 */
export function FilterBar({ children }: FilterBarProps) {
  return <div className="filters">{children}</div>;
}

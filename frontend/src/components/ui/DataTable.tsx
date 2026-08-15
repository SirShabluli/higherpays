import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string | number;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  emptyTitle?: string;
  emptyHint?: ReactNode;
  emptyAction?: ReactNode;
  footer?: ReactNode;
}

/**
 * Thin, type-safe wrapper around the app's shared `.tablewrap > table` styles.
 * Handles loading, empty, and clickable-row cases so pages don't reimplement
 * them each time.
 */
export function DataTable<T>(props: DataTableProps<T>) {
  const {
    columns, rows, rowKey, onRowClick, isLoading,
    emptyTitle = 'Nothing here yet.', emptyHint, emptyAction, footer,
  } = props;

  return (
    <div className="card">
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ textAlign: c.align, width: c.width }}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title={emptyTitle} hint={emptyHint} action={emptyAction} />
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className="txrow"
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} style={{ textAlign: c.align }}>{c.render(row)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer ? (
        <div style={{ padding: '8px 12px', fontSize: '13.2px', color: 'var(--muted)' }}>{footer}</div>
      ) : null}
    </div>
  );
}

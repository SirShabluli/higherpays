import { useState } from 'react';
import { MONTHS_SHORT } from '../../lib/format';

export interface DateRange {
  from: string;
  to: string;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (r: DateRange) => void;
}

function formatLabel(v: string): string {
  const d = new Date(`${v}T00:00:00`);
  const day = d.getDate();
  const month = MONTHS_SHORT[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * Two-input date-range popover triggered from a button. Empty strings mean
 * "no bound" — the caller can render "All time" in that case.
 */
export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const label =
    !value.from && !value.to ? 'All time' :
    value.from && value.to ? `${formatLabel(value.from)} – ${formatLabel(value.to)}` :
    value.from ? `From ${formatLabel(value.from)}` :
    `Until ${formatLabel(value.to)}`;

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn ghost"
        onClick={() => setOpen((o) => !o)}
        style={{ fontSize: '13.2px' }}
      >
        {label}
      </button>
      {open ? (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 10,
            background: 'var(--panel)', border: '1px solid var(--line)',
            borderRadius: 12, padding: 14,
            display: 'flex', flexDirection: 'column', gap: 10, minWidth: 220,
          }}
        >
          <div className="field">
            <label>From</label>
            <input
              type="date"
              value={value.from}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
            />
          </div>
          <div className="field">
            <label>To</label>
            <input
              type="date"
              value={value.to}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn ghost"
              onClick={() => onChange({ from: '', to: '' })}
            >
              All time
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Apply</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

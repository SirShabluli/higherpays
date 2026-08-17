import { useTimezone } from '../../hooks/useTimezone';
import { formatDateTime } from '../../lib/format';

interface DateCellProps {
  ts: number | string;
}

/**
 * Renders a timestamp as two lines: the date on top, the time (dimmer) below.
 * Reads the resolved timezone from user preferences so tables don't have to.
 */
export function DateCell({ ts }: DateCellProps) {
  const tz = useTimezone();
  const n = typeof ts === 'string' ? Date.parse(ts) : ts;
  if (!Number.isFinite(n)) return <span className="time">—</span>;
  const { date, time } = formatDateTime(n, tz);
  return (
    <span className="time">
      {date}
      <br />
      <span style={{ color: '#4d5a72' }}>{time}</span>
    </span>
  );
}

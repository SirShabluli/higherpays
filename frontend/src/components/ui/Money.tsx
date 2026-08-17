import { formatMoney } from '../../lib/format';
import { useCurrentSession } from '../../hooks/useCurrentSession';

interface MoneyProps {
  amount: number;
  currency?: string;
  emphasis?: boolean;
}

/**
 * Formats a number as currency using the active workspace's currency (falling
 * back to EUR). `emphasis` applies a subtle weight; use it on totals.
 */
export function Money({ amount, currency, emphasis }: MoneyProps) {
  const session = useCurrentSession();
  const c = currency ?? session.currency;
  const text = formatMoney(amount, c);
  if (emphasis) return <b>{text}</b>;
  return <span className="amt">{text}</span>;
}

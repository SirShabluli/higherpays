import { usePreferencesStore } from '../store/preferences';
import { resolveTimezone } from '../lib/format/date';

/** Resolved IANA timezone the user has picked (or the browser default). */
export function useTimezone(): string {
  const mode = usePreferencesStore((s) => s.tzMode);
  const manual = usePreferencesStore((s) => s.tzManual);
  return resolveTimezone(mode, manual);
}

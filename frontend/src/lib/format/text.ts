/**
 * Small text helpers.
 */

/**
 * Returns up to `count` uppercase initials from a name, or a single '?' when
 * the input is empty. Handles single-word names ("Cher"), splits on any run
 * of whitespace, and skips extraneous tokens.
 */
export function initials(name: string, count: number = 2): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const chars = parts.slice(0, count).map((p) => p.charAt(0).toUpperCase());
  return chars.join('');
}

/** Truncates with an ellipsis if longer than `max`. Preserves whole words. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const clipped = text.slice(0, max);
  const lastSpace = clipped.lastIndexOf(' ');
  return (lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped) + '\u2026';
}

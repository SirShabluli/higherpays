import { describe, it, expect } from 'vitest';
import { initials, truncate } from './text';

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Ava Lane')).toBe('AL');
    expect(initials('john doe')).toBe('JD');
  });

  it('handles a single-word name', () => {
    expect(initials('Cher')).toBe('C');
  });

  it('caps the number of initials with the count arg', () => {
    expect(initials('Anna Marie Louise', 3)).toBe('AML');
    expect(initials('Anna Marie Louise', 2)).toBe('AM');
  });

  it('returns "?" for empty input', () => {
    expect(initials('')).toBe('?');
    expect(initials('   ')).toBe('?');
  });
});

describe('truncate', () => {
  it('leaves short strings alone', () => {
    expect(truncate('short', 10)).toBe('short');
  });

  it('truncates at a word boundary and appends an ellipsis', () => {
    expect(truncate('this is a long sentence', 10)).toBe('this is a\u2026');
  });

  it('hard-cuts when there is no space to break on', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcde\u2026');
  });
});

import { describe, expect, it } from 'vitest';
import { isUlid, secretToken, ulid } from '../src/lib/ids.js';

describe('ulid', () => {
  it('is 26 Crockford base32 characters', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
  });

  it('sorts by creation time, which is why it is the primary key', () => {
    const earlier = ulid(1_000_000_000_000);
    const later = ulid(2_000_000_000_000);
    expect(earlier < later).toBe(true);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 20_000 }, () => ulid()));
    expect(ids.size).toBe(20_000);
  });

  it('is unpredictable within one millisecond, so ids cannot be enumerated', () => {
    const at = 1_700_000_000_000;
    const a = ulid(at);
    const b = ulid(at);
    expect(a.slice(0, 10)).toBe(b.slice(0, 10)); // same timestamp
    expect(a.slice(10)).not.toBe(b.slice(10)); // different randomness
  });

  it('refuses a timestamp it cannot encode', () => {
    expect(() => ulid(-1)).toThrow(RangeError);
    expect(() => ulid(2 ** 49)).toThrow(RangeError);
  });
});

describe('isUlid', () => {
  it('rejects the ambiguous Crockford letters', () => {
    // I, L, O and U are excluded from the alphabet on purpose.
    expect(isUlid('I'.repeat(26))).toBe(false);
    expect(isUlid('U'.repeat(26))).toBe(false);
  });

  it('rejects anything that is not exactly 26 characters', () => {
    expect(isUlid(ulid().slice(1))).toBe(false);
    expect(isUlid(`${ulid()}A`)).toBe(false);
  });
});

describe('secretToken', () => {
  it('is base64url, so it survives a header, a query string and a YAML file', () => {
    expect(secretToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => secretToken()));
    expect(tokens.size).toBe(1000);
  });
});

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { timingSafeCompareHex, timingSafeCompareStrings } from './timingSafeCompare';

describe('timingSafeCompareStrings', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeCompareStrings('abc', 'abc')).toBe(true);
    expect(timingSafeCompareStrings('', '')).toBe(true);
    expect(
      timingSafeCompareStrings('a long shared secret token', 'a long shared secret token'),
    ).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(timingSafeCompareStrings('abc', 'abd')).toBe(false);
    expect(timingSafeCompareStrings('SECRET-A', 'SECRET-B')).toBe(false);
  });

  it('returns false for strings of different length without throwing', () => {
    expect(timingSafeCompareStrings('abc', 'abcd')).toBe(false);
    expect(timingSafeCompareStrings('', 'a')).toBe(false);
    expect(timingSafeCompareStrings('long-secret', '')).toBe(false);
  });

  it('handles unicode strings byte-correctly', () => {
    // Two strings that are visually equal must compare equal.
    expect(timingSafeCompareStrings('ñ', 'ñ')).toBe(true);
    // Different unicode codepoints with the same UTF-8 byte length must
    // still be detected as different.
    expect(timingSafeCompareStrings('ñ', 'á')).toBe(false);
  });
});

const computeHmac = (key: string, body: string) =>
  createHmac('sha256', key).update(body).digest('hex');

describe('timingSafeCompareHex', () => {
  const secret = 'shared-signing-key';
  const payload = '{"event":"User.Data.Updated"}';

  it('returns true for matching HMAC-SHA256 hex digests', () => {
    const a = computeHmac(secret, payload);
    const b = computeHmac(secret, payload);
    expect(timingSafeCompareHex(a, b)).toBe(true);
  });

  it('returns false when the signing key differs', () => {
    const a = computeHmac(secret, payload);
    const b = computeHmac('other-key', payload);
    expect(timingSafeCompareHex(a, b)).toBe(false);
  });

  it('returns false when the payload differs', () => {
    const a = computeHmac(secret, payload);
    const b = computeHmac(secret, payload + 'tampered');
    expect(timingSafeCompareHex(a, b)).toBe(false);
  });

  it('returns false for hex strings of different length', () => {
    expect(timingSafeCompareHex('abcd', 'abcdef')).toBe(false);
  });

  it('returns false when one input contains non-hex characters', () => {
    const valid = computeHmac(secret, payload);
    // Same length, but with non-hex chars — Buffer.from('xx', 'hex')
    // truncates and the length guard rejects it.
    const garbage = 'z'.repeat(valid.length);
    expect(timingSafeCompareHex(valid, garbage)).toBe(false);
  });

  it('returns false for two empty strings (no signature is invalid)', () => {
    expect(timingSafeCompareHex('', '')).toBe(false);
  });
});

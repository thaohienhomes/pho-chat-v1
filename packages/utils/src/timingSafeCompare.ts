import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison helpers — server-only.
 *
 * Why this exists (PHO-245 / A1.12):
 *   JavaScript `===` short-circuits on the first differing byte. The time
 *   a comparison takes therefore leaks how many leading bytes match,
 *   which lets an attacker brute-force a webhook signature byte-by-byte
 *   given enough requests. `crypto.timingSafeEqual` always walks every
 *   byte, so a wrong byte at position 0 takes the same time as one at
 *   position 31.
 *
 *   Length is NOT secret — comparing strings of different lengths is
 *   pointless and `timingSafeEqual` throws on mismatched buffer lengths,
 *   so we short-circuit on length explicitly. Both helpers fail closed
 *   (return false) on any conversion error.
 */

/**
 * Compare two arbitrary strings (shared secret tokens, base64, etc.) in
 * constant time. Use when you don't know — or don't care about — the
 * encoding of the input.
 */
export const timingSafeCompareStrings = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;

  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
};

/**
 * Compare two hex-encoded signatures (e.g. `hmac.digest('hex')`) in
 * constant time. Decoding to raw bytes first means the comparison length
 * is the actual signature length (32 bytes for SHA-256), which is the
 * most efficient form.
 *
 * Falls back to false if either input is not valid hex.
 */
export const timingSafeCompareHex = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;

  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    // Buffer.from('xx', 'hex') silently truncates on invalid input — guard
    // against that so a malformed signature can't accidentally match.
    if (bufA.length === 0 || bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
};

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hashEmail,
  hashExternalId,
  hashPhoneNumber,
  hashUserPII,
  isCryptoAvailable,
  sha256Hash,
} from '../crypto-hash';

// Mock crypto.subtle
const mockDigest = vi.fn();
const mockCrypto = {
  subtle: {
    digest: mockDigest,
  },
};

// Shared encode spy so assertions can observe calls regardless of which
// TextEncoder instance the source code constructs internally.
const mockEncode = vi.fn();

describe('Crypto Hash Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock window.crypto (configurable so individual tests can delete it)
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: mockCrypto,
      writable: true,
    });

    // Mock TextEncoder with a shared encode spy across all instances
    mockEncode.mockReturnValue(new Uint8Array([116, 101, 115, 116])); // 'test' in bytes
    global.TextEncoder = vi.fn().mockImplementation(() => ({
      encode: mockEncode,
    }));

    // Mock successful hash result
    const mockHashBuffer = new ArrayBuffer(32);
    const mockHashArray = new Uint8Array(mockHashBuffer);
    mockHashArray.fill(170); // Fill with 0xAA for predictable hex output
    mockDigest.mockResolvedValue(mockHashBuffer);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isCryptoAvailable', () => {
    it('should return true when crypto.subtle is available', () => {
      expect(isCryptoAvailable()).toBe(true);
    });

    it('should return false when crypto is not available', () => {
      delete (window as any).crypto;
      expect(isCryptoAvailable()).toBe(false);
    });

    it('should return false when crypto.subtle is not available', () => {
      (window as any).crypto = {};
      expect(isCryptoAvailable()).toBe(false);
    });
  });

  describe('sha256Hash', () => {
    it('should hash a string successfully', async () => {
      const result = await sha256Hash('test@example.com');

      expect(mockDigest).toHaveBeenCalledWith('SHA-256', expect.any(Uint8Array));
      expect(result).toBe('a'.repeat(64)); // 32 bytes of 0xAA = 64 'a' characters
    });

    it('should normalize input by trimming and lowercasing', async () => {
      await sha256Hash('  TEST@EXAMPLE.COM  ');

      expect(mockEncode).toHaveBeenCalledWith('test@example.com');
    });

    it('should throw error for empty input', async () => {
      await expect(sha256Hash('')).rejects.toThrow('Input must be a non-empty string');
    });

    it('should throw error for non-string input', async () => {
      await expect(sha256Hash(null as any)).rejects.toThrow('Input must be a non-empty string');
    });

    it('should throw a hashing error when crypto is unavailable', async () => {
      // Removing window.crypto in jsdom keeps `window` defined, so the source
      // proceeds past the browser-environment guard and fails inside digest().
      delete (window as any).crypto;

      await expect(sha256Hash('test')).rejects.toThrow('Hash generation failed');
    });

    it('should handle crypto.subtle.digest errors', async () => {
      mockDigest.mockRejectedValue(new Error('Crypto error'));

      await expect(sha256Hash('test')).rejects.toThrow('Hash generation failed');
    });
  });

  describe('hashEmail', () => {
    it('should hash valid email', async () => {
      const result = await hashEmail('test@example.com');
      expect(result).toBe('a'.repeat(64));
    });

    it('should throw error for invalid email', async () => {
      await expect(hashEmail('invalid-email')).rejects.toThrow('Invalid email address');
    });

    it('should throw error for empty email', async () => {
      await expect(hashEmail('')).rejects.toThrow('Invalid email address');
    });
  });

  describe('hashPhoneNumber', () => {
    it('should hash valid phone number', async () => {
      const result = await hashPhoneNumber('+1-234-567-8900');
      expect(result).toBe('a'.repeat(64));
    });

    it('should normalize phone number by removing non-digits', async () => {
      await hashPhoneNumber('+1 (234) 567-8900');

      expect(mockEncode).toHaveBeenCalledWith('12345678900');
    });

    it('should throw error for empty phone', async () => {
      await expect(hashPhoneNumber('')).rejects.toThrow('Phone number is required');
    });

    it('should throw error for phone with less than 10 digits', async () => {
      await expect(hashPhoneNumber('123456789')).rejects.toThrow(
        'Phone number must be at least 10 digits',
      );
    });
  });

  describe('hashExternalId', () => {
    it('should hash valid external ID', async () => {
      const result = await hashExternalId('user123');
      expect(result).toBe('a'.repeat(64));
    });

    it('should throw error for empty external ID', async () => {
      await expect(hashExternalId('')).rejects.toThrow('External ID is required');
    });
  });

  describe('hashUserPII', () => {
    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('should hash all valid user data', async () => {
      const userData = {
        email: 'test@example.com',
        phone: '+1-234-567-8900',
        userId: 'user123',
      };

      const result = await hashUserPII(userData);

      expect(result).toEqual({
        email: 'a'.repeat(64),
        external_id: 'a'.repeat(64),
        phone_number: 'a'.repeat(64),
      });
    });

    it('should skip invalid data and continue with valid ones', async () => {
      const userData = {
        email: 'invalid-email',
        phone: '+1-234-567-8900',
        userId: 'user123',
      };

      const result = await hashUserPII(userData);

      expect(result).toEqual({
        external_id: 'a'.repeat(64),
        phone_number: 'a'.repeat(64),
      });
      expect(console.warn).toHaveBeenCalledWith('Failed to hash email:', expect.any(Error));
    });

    it('should return empty object when no valid data provided', async () => {
      const result = await hashUserPII({});
      expect(result).toEqual({});
    });

    it('should handle hashing errors gracefully', async () => {
      mockDigest.mockRejectedValue(new Error('Crypto error'));

      const userData = {
        email: 'test@example.com',
        phone: '+1-234-567-8900',
      };

      const result = await hashUserPII(userData);

      expect(result).toEqual({});
      expect(console.warn).toHaveBeenCalledTimes(2);
    });
  });
});

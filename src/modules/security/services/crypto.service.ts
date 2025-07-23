import { Injectable, Logger } from '@nestjs/common';
import {
  createHash,
  randomBytes,
  timingSafeEqual,
  pbkdf2Sync,
} from 'crypto';

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly SALT_LENGTH = 32;
  private readonly KEY_LENGTH = 32;
  private readonly PBKDF2_ITERATIONS = 100000;
  private readonly PBKDF2_DIGEST = 'sha512';

  /**
   * Hash an API key for secure storage using PBKDF2
   */
  hashApiKey(apiKey: string): string {
    const salt = this.generateSalt();
    const hash = pbkdf2Sync(
      apiKey,
      salt,
      this.PBKDF2_ITERATIONS,
      64, // 64 bytes for the derived key
      this.PBKDF2_DIGEST,
    ).toString('hex');
    return `${salt}:${hash}`;
  }

  /**
   * Verify an API key against a stored hash
   */
  verifyApiKey(apiKey: string, storedHash: string): boolean {
    const [salt, hash] = storedHash.split(':');
    if (!salt || !hash) {
      return false;
    }

    const hashToVerify = pbkdf2Sync(
      apiKey,
      salt,
      this.PBKDF2_ITERATIONS,
      64,
      this.PBKDF2_DIGEST,
    ).toString('hex');

    return this.compareHashes(hash, hashToVerify);
  }

  /**
   * Generate a cryptographically secure API key
   */
  generateApiKey(): string {
    // Generate 32 random bytes and encode as base64url
    const keyBytes = randomBytes(this.KEY_LENGTH);

    // Use base64url encoding (URL-safe, no padding)
    return keyBytes
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Generate a secure random string for various purposes
   */
  generateSecureRandom(length: number = 32): string {
    const bytes = randomBytes(Math.ceil(length / 2));
    return bytes.toString('hex').slice(0, length);
  }

  /**
   * Timing-safe comparison for API key validation
   * Prevents timing attacks
   */
  compareHashes(hash1: string, hash2: string): boolean {
    if (hash1.length !== hash2.length) {
      return false;
    }

    try {
      const buffer1 = Buffer.from(hash1, 'hex');
      const buffer2 = Buffer.from(hash2, 'hex');

      return timingSafeEqual(buffer1, buffer2);
    } catch (error) {
      this.logger.warn('Hash comparison failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Validate API key format
   */
  isValidApiKeyFormat(apiKey: string): boolean {
    // Base64url format: 43 characters (32 bytes -> 43 chars base64url)
    const base64urlPattern = /^[A-Za-z0-9_-]{43}$/;
    return base64urlPattern.test(apiKey);
  }

  /**
   * Hash arbitrary strings for security purposes
   */
  hashString(input: string): string {
    const hash = createHash('sha256');
    hash.update(input);
    return hash.digest('hex');
  }

  /**
   * Generate a salt for password hashing (if needed in the future)
   */
  generateSalt(): string {
    return randomBytes(this.SALT_LENGTH).toString('hex');
  }
}

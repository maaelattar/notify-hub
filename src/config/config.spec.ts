import { validateConfig } from './config';
import { validateNotificationConfig } from '../modules/notifications/config/notification.config';

describe('Configuration Validation', () => {
  describe('Main Configuration', () => {
    it('should validate with minimal required fields', () => {
      const validConfig = {
        NODE_ENV: 'development',
        PORT: '3000',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
        JWT_SECRET:
          'this-is-a-very-long-secret-key-for-jwt-validation-purposes',
      };

      expect(() => validateConfig(validConfig)).not.toThrow();
    });

    it('should validate with all fields', () => {
      const validConfig = {
        NODE_ENV: 'production',
        PORT: '8080',
        DATABASE_URL: 'postgresql://user:pass@prod.example.com:5432/notifyhub',
        REDIS_HOST: 'redis.example.com',
        REDIS_PORT: '6379',
        REDIS_PASSWORD: 'redis-password',
        CORS_ORIGIN: 'https://app.example.com,https://admin.example.com',
        JWT_SECRET: 'super-secure-jwt-secret-key-for-production-environment',
        API_BASE_URL: 'https://api.example.com',
      };

      const result = validateConfig(validConfig);
      expect(result.NODE_ENV).toBe('production');
      expect(result.PORT).toBe(8080);
      expect(result.REDIS_HOST).toBe('redis.example.com');
      expect(result.REDIS_PORT).toBe(6379);
    });

    it('should use defaults for optional fields', () => {
      const minimalConfig = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
        JWT_SECRET:
          'this-is-a-very-long-secret-key-for-jwt-validation-purposes',
      };

      const result = validateConfig(minimalConfig);
      expect(result.NODE_ENV).toBe('development');
      expect(result.PORT).toBe(3000);
      expect(result.REDIS_HOST).toBe('localhost');
      expect(result.REDIS_PORT).toBe(6379);
      expect(result.API_BASE_URL).toBe('http://localhost:3000');
    });

    it('should reject invalid environment', () => {
      const invalidConfig = {
        NODE_ENV: 'invalid',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
        JWT_SECRET: 'valid-secret-key-that-is-long-enough',
      };

      expect(() => validateConfig(invalidConfig)).toThrow(/valid/);
    });

    it('should reject short JWT secret', () => {
      const invalidConfig = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
        JWT_SECRET: 'short',
      };

      expect(() => validateConfig(invalidConfig)).toThrow(/32 characters/);
    });

    it('should reject invalid DATABASE_URL', () => {
      const invalidConfig = {
        DATABASE_URL: 'not-a-valid-url',
        JWT_SECRET:
          'this-is-a-very-long-secret-key-for-jwt-validation-purposes',
      };

      expect(() => validateConfig(invalidConfig)).toThrow(/uri/);
    });

    it('should reject invalid PORT', () => {
      const invalidConfig = {
        PORT: '99999', // Invalid port number
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
        JWT_SECRET:
          'this-is-a-very-long-secret-key-for-jwt-validation-purposes',
      };

      expect(() => validateConfig(invalidConfig)).toThrow();
    });
  });

  describe('Notification Configuration', () => {
    it('should validate with defaults', () => {
      const config = {};

      expect(() => validateNotificationConfig(config)).not.toThrow();
    });

    it('should validate with custom values', () => {
      const config = {
        NOTIFICATION_MAX_RETRIES: '5',
        NOTIFICATION_DEFAULT_PAGE_SIZE: '25',
        NOTIFICATION_MAX_PAGE_SIZE: '200',
        NOTIFICATION_RECENT_FAILURES_WINDOW_MINUTES: '120',
        NOTIFICATION_PENDING_BATCH_SIZE: '150',
        NOTIFICATION_MAX_RECENT_FAILURES_DISPLAY: '15',
      };

      const result = validateNotificationConfig(config);
      expect(result.NOTIFICATION_MAX_RETRIES).toBe(5);
      expect(result.NOTIFICATION_DEFAULT_PAGE_SIZE).toBe(25);
    });

    it('should reject values outside valid ranges', () => {
      const invalidConfig = {
        NOTIFICATION_MAX_RETRIES: '15', // Max is 10
      };

      expect(() => validateNotificationConfig(invalidConfig)).toThrow();
    });

    it('should reject negative values', () => {
      const invalidConfig = {
        NOTIFICATION_DEFAULT_PAGE_SIZE: '-5',
      };

      expect(() => validateNotificationConfig(invalidConfig)).toThrow();
    });
  });

  describe('Redis Configuration Types', () => {
    it('should handle Redis configuration types correctly', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
        JWT_SECRET:
          'this-is-a-very-long-secret-key-for-jwt-validation-purposes',
        REDIS_HOST: 'localhost',
        REDIS_PORT: '6379',
      };

      const result = validateConfig(config);
      expect(typeof result.REDIS_HOST).toBe('string');
      expect(typeof result.REDIS_PORT).toBe('number');
      expect(result.REDIS_PORT).toBe(6379);
    });

    it('should handle optional Redis password', () => {
      const configWithPassword = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
        JWT_SECRET:
          'this-is-a-very-long-secret-key-for-jwt-validation-purposes',
        REDIS_PASSWORD: 'redis-secret',
      };

      const result = validateConfig(configWithPassword);
      expect(result.REDIS_PASSWORD).toBe('redis-secret');
    });
  });

  describe('CORS Configuration', () => {
    it('should handle multiple CORS origins', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
        JWT_SECRET:
          'this-is-a-very-long-secret-key-for-jwt-validation-purposes',
        CORS_ORIGIN: 'https://app1.com,https://app2.com,https://app3.com',
      };

      const result = validateConfig(config);
      expect(result.CORS_ORIGIN).toBe(
        'https://app1.com,https://app2.com,https://app3.com',
      );
    });

    it('should handle empty CORS origin', () => {
      const config = {
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
        JWT_SECRET:
          'this-is-a-very-long-secret-key-for-jwt-validation-purposes',
        CORS_ORIGIN: '',
      };

      expect(() => validateConfig(config)).not.toThrow();
    });
  });
});

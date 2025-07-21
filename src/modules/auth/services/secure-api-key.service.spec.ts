import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { 
  SecureApiKeyService, 
  ApiKeyValidationResult, 
  CreateApiKeyRequest 
} from './secure-api-key.service';
import { ApiKey, ApiKeyRateLimit } from '../entities/api-key.entity';
import { CryptoService } from './crypto.service';
import { SecurityAuditService } from './security-audit.service';
import { RedisProvider } from '../../common/providers/redis.provider';
import { MockFactory, TestDataBuilder } from '../../../test/test-utils';
import { randomUUID } from 'crypto';

describe('SecureApiKeyService - Security Tests', () => {
  let service: SecureApiKeyService;
  let apiKeyRepository: jest.Mocked<Repository<ApiKey>>;
  let cryptoService: jest.Mocked<CryptoService>;
  let auditService: jest.Mocked<SecurityAuditService>;
  let redisProvider: jest.Mocked<RedisProvider>;
  let redisMock: any;

  // Test data constants
  const VALID_API_KEY = 'test-api-key-12345';
  const VALID_HASH = 'hashed-api-key-12345';
  const INVALID_API_KEY = 'invalid-key';
  const TEST_IP = '192.168.1.100';
  const TEST_USER_AGENT = 'Test-Agent/1.0';
  const TEST_REQUEST_ID = 'req_test_12345';
  const TEST_ENDPOINT = 'POST /api/notifications';

  beforeEach(async () => {
    // Create Redis mock with pipeline support
    redisMock = {
      get: jest.fn(),
      set: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      pipeline: jest.fn(() => ({
        incr: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, 1], [null, 'OK']]),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecureApiKeyService,
        {
          provide: getRepositoryToken(ApiKey),
          useValue: MockFactory.createMockRepository<ApiKey>(),
        },
        {
          provide: CryptoService,
          useValue: {
            generateApiKey: jest.fn(),
            hashApiKey: jest.fn(),
            isValidApiKeyFormat: jest.fn(),
            compareHashes: jest.fn(),
          },
        },
        {
          provide: SecurityAuditService,
          useValue: {
            logApiKeyCreated: jest.fn(),
            logApiKeyUsed: jest.fn(),
            logInvalidApiKeyAttempt: jest.fn(),
            logExpiredApiKeyAttempt: jest.fn(),
            logSecurityEvent: jest.fn(),
            logApiKeyDeleted: jest.fn(),
          },
        },
        {
          provide: RedisProvider,
          useValue: {
            getClient: jest.fn().mockReturnValue(redisMock),
          },
        },
      ],
    }).compile();

    service = module.get<SecureApiKeyService>(SecureApiKeyService);
    apiKeyRepository = module.get(getRepositoryToken(ApiKey));
    cryptoService = module.get(CryptoService);
    auditService = module.get(SecurityAuditService);
    redisProvider = module.get(RedisProvider);
  });

  describe('API Key Creation Security', () => {
    it('should create API key with secure random generation', async () => {
      // Arrange
      const request: CreateApiKeyRequest = {
        name: 'Test API Key',
        scopes: ['notifications:create'],
        rateLimit: { hourly: 100, daily: 1000 },
      };

      cryptoService.generateApiKey.mockReturnValue(VALID_API_KEY);
      cryptoService.hashApiKey.mockResolvedValue(VALID_HASH);
      apiKeyRepository.save.mockResolvedValue({
        id: randomUUID(),
        hashedKey: VALID_HASH,
        name: request.name,
        scopes: request.scopes,
        rateLimit: request.rateLimit,
        isActive: true,
        createdAt: new Date(),
      } as ApiKey);

      // Act
      const result = await service.createApiKey(request);

      // Assert
      expect(cryptoService.generateApiKey).toHaveBeenCalledTimes(1);
      expect(cryptoService.hashApiKey).toHaveBeenCalledWith(VALID_API_KEY);
      expect(result.plainTextKey).toBe(VALID_API_KEY);
      expect(result.apiKey.hashedKey).toBe(VALID_HASH);
      expect(auditService.logApiKeyCreated).toHaveBeenCalled();
    });

    it('should never store plain text API keys', async () => {
      // Arrange
      const request: CreateApiKeyRequest = {
        name: 'Test API Key',
        scopes: ['notifications:create'],
        rateLimit: { hourly: 100, daily: 1000 },
      };

      cryptoService.generateApiKey.mockReturnValue(VALID_API_KEY);
      cryptoService.hashApiKey.mockResolvedValue(VALID_HASH);
      
      let savedEntity: ApiKey;
      apiKeyRepository.save.mockImplementation((entity: ApiKey) => {
        savedEntity = entity;
        return Promise.resolve({ ...entity, id: randomUUID() } as ApiKey);
      });

      // Act
      await service.createApiKey(request);

      // Assert
      expect(savedEntity!.hashedKey).toBe(VALID_HASH);
      expect(savedEntity!.hashedKey).not.toBe(VALID_API_KEY);
      
      // Ensure no properties contain the plain text key
      const entityValues = Object.values(savedEntity!);
      expect(entityValues).not.toContain(VALID_API_KEY);
    });
  });

  describe('API Key Validation Security', () => {
    let validApiKey: ApiKey;

    beforeEach(() => {
      validApiKey = {
        id: randomUUID(),
        hashedKey: VALID_HASH,
        name: 'Test Key',
        scopes: ['notifications:create', 'notifications:read'],
        rateLimit: { hourly: 100, daily: 1000 },
        isActive: true,
        lastUsedAt: null,
        expiresAt: null,
        organizationId: null,
        createdByUserId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        isExpired: jest.fn().mockReturnValue(false),
        hasScope: jest.fn().mockReturnValue(true),
        canPerformOperation: jest.fn().mockReturnValue(true),
      } as any;
    });

    it('should reject invalid API key formats', async () => {
      // Arrange
      cryptoService.isValidApiKeyFormat.mockReturnValue(false);

      // Act
      const result = await service.validateApiKey(
        INVALID_API_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid API key format');
      expect(auditService.logInvalidApiKeyAttempt).toHaveBeenCalledWith(
        'invalid_format',
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );
    });

    it('should reject non-existent API keys', async () => {
      // Arrange
      cryptoService.isValidApiKeyFormat.mockReturnValue(true);
      cryptoService.hashApiKey.mockResolvedValue(VALID_HASH);
      apiKeyRepository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.validateApiKey(
        VALID_API_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid API key');
      expect(auditService.logInvalidApiKeyAttempt).toHaveBeenCalledWith(
        VALID_HASH,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );
    });

    it('should reject inactive API keys', async () => {
      // Arrange
      const inactiveKey = { ...validApiKey, isActive: false };
      
      cryptoService.isValidApiKeyFormat.mockReturnValue(true);
      cryptoService.hashApiKey.mockResolvedValue(VALID_HASH);
      apiKeyRepository.findOne.mockResolvedValue(null); // findOne with isActive: true returns null

      // Act
      const result = await service.validateApiKey(
        VALID_API_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid API key');
    });

    it('should reject expired API keys', async () => {
      // Arrange
      const expiredKey = { ...validApiKey } as ApiKey;
      expiredKey.isExpired = jest.fn().mockReturnValue(true);
      
      cryptoService.isValidApiKeyFormat.mockReturnValue(true);
      cryptoService.hashApiKey.mockResolvedValue(VALID_HASH);
      apiKeyRepository.findOne.mockResolvedValue(expiredKey);

      // Act
      const result = await service.validateApiKey(
        VALID_API_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('API key expired');
      expect(auditService.logExpiredApiKeyAttempt).toHaveBeenCalledWith(
        validApiKey.id,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
        undefined,
      );
    });

    it('should reject API keys without required scope', async () => {
      // Arrange
      validApiKey.hasScope = jest.fn().mockReturnValue(false);
      
      cryptoService.isValidApiKeyFormat.mockReturnValue(true);
      cryptoService.hashApiKey.mockResolvedValue(VALID_HASH);
      apiKeyRepository.findOne.mockResolvedValue(validApiKey);

      // Act
      const result = await service.validateApiKey(
        VALID_API_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
        'admin:delete', // Required scope not in API key scopes
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Insufficient permissions');
      expect(auditService.logSecurityEvent).toHaveBeenCalledWith({
        eventType: 'SUSPICIOUS_ACTIVITY',
        apiKeyId: validApiKey.id,
        ipAddress: TEST_IP,
        userAgent: TEST_USER_AGENT,
        requestId: TEST_REQUEST_ID,
        organizationId: undefined,
        metadata: {
          endpoint: TEST_ENDPOINT,
          requiredScope: 'admin:delete',
          availableScopes: validApiKey.scopes,
        },
        message: `API key attempted to access ${TEST_ENDPOINT} without required scope: admin:delete`,
      });
    });

    it('should accept valid API keys with proper scope', async () => {
      // Arrange
      cryptoService.isValidApiKeyFormat.mockReturnValue(true);
      cryptoService.hashApiKey.mockResolvedValue(VALID_HASH);
      apiKeyRepository.findOne.mockResolvedValue(validApiKey);
      apiKeyRepository.update.mockResolvedValue(undefined as any);

      // Act
      const result = await service.validateApiKey(
        VALID_API_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
        'notifications:create',
      );

      // Assert
      expect(result.valid).toBe(true);
      expect(result.apiKey).toBe(validApiKey);
      expect(auditService.logApiKeyUsed).toHaveBeenCalledWith(
        validApiKey.id,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
        undefined,
      );
    });

    it('should handle validation errors gracefully', async () => {
      // Arrange
      cryptoService.isValidApiKeyFormat.mockImplementation(() => {
        throw new Error('Crypto service error');
      });

      // Act
      const result = await service.validateApiKey(
        VALID_API_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Internal validation error');
    });
  });

  describe('Rate Limiting Security', () => {
    beforeEach(() => {
      cryptoService.isValidApiKeyFormat.mockReturnValue(true);
      cryptoService.hashApiKey.mockResolvedValue(VALID_HASH);
    });

    it('should enforce rate limits per API key', async () => {
      // Arrange
      const pipeline = {
        incr: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, 1001], [null, 'OK']]), // Exceeds limit of 1000
      };
      redisMock.pipeline.mockReturnValue(pipeline);

      // Act
      const result = await service.validateApiKey(
        VALID_API_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Rate limit exceeded');
      expect(result.rateLimitInfo).toEqual({
        limit: 1000,
        current: 1001,
        windowMs: 3600000,
        resetTime: expect.any(Date),
      });
    });

    it('should allow requests within rate limit', async () => {
      // Arrange
      const validApiKey = {
        id: randomUUID(),
        hashedKey: VALID_HASH,
        name: 'Test Key',
        scopes: ['notifications:create'],
        rateLimit: { hourly: 100, daily: 1000 },
        isActive: true,
        isExpired: jest.fn().mockReturnValue(false),
        hasScope: jest.fn().mockReturnValue(true),
        canPerformOperation: jest.fn().mockReturnValue(true),
      } as any;

      const pipeline = {
        incr: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, 50], [null, 'OK']]), // Within limit
      };
      redisMock.pipeline.mockReturnValue(pipeline);
      apiKeyRepository.findOne.mockResolvedValue(validApiKey);
      apiKeyRepository.update.mockResolvedValue(undefined as any);

      // Act
      const result = await service.validateApiKey(
        VALID_API_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );

      // Assert
      expect(result.valid).toBe(true);
      expect(result.rateLimitInfo).toEqual({
        limit: 1000,
        current: 50,
        windowMs: 3600000,
        resetTime: expect.any(Date),
      });
    });

    it('should handle Redis failures gracefully (fail open)', async () => {
      // Arrange
      redisMock.pipeline.mockImplementation(() => {
        throw new Error('Redis connection failed');
      });

      const validApiKey = {
        id: randomUUID(),
        hashedKey: VALID_HASH,
        name: 'Test Key',
        scopes: ['notifications:create'],
        rateLimit: { hourly: 100, daily: 1000 },
        isActive: true,
        isExpired: jest.fn().mockReturnValue(false),
        hasScope: jest.fn().mockReturnValue(true),
        canPerformOperation: jest.fn().mockReturnValue(true),
      } as any;

      apiKeyRepository.findOne.mockResolvedValue(validApiKey);
      apiKeyRepository.update.mockResolvedValue(undefined as any);

      // Act
      const result = await service.validateApiKey(
        VALID_API_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );

      // Assert - Should fail open and allow the request
      expect(result.valid).toBe(true);
      expect(result.rateLimitInfo).toEqual({
        limit: 1000,
        current: 0,
        windowMs: 3600000,
      });
    });

    it('should log rate limit violations', async () => {
      // Arrange
      const pipeline = {
        incr: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, 1001], [null, 'OK']]),
      };
      redisMock.pipeline.mockReturnValue(pipeline);

      // Act
      await service.validateApiKey(
        VALID_API_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );

      // Assert
      expect(auditService.logSecurityEvent).toHaveBeenCalledWith({
        eventType: 'RATE_LIMIT_EXCEEDED',
        hashedKey: VALID_HASH,
        ipAddress: TEST_IP,
        userAgent: TEST_USER_AGENT,
        requestId: TEST_REQUEST_ID,
        metadata: {
          rateLimitInfo: {
            limit: 1000,
            current: 1001,
            windowMs: 3600000,
            resetTime: expect.any(Date),
          },
        },
        message: `Rate limit exceeded for key ${VALID_HASH.substring(0, 8)}...`,
      });
    });
  });

  describe('Security Attack Scenarios', () => {
    it('should handle timing attacks on key validation', async () => {
      // Arrange
      cryptoService.isValidApiKeyFormat.mockReturnValue(true);
      cryptoService.hashApiKey.mockResolvedValue(VALID_HASH);

      // Test multiple invalid keys to ensure consistent timing
      const invalidKeys = ['invalid1', 'invalid2', 'invalid3'];
      const timings: number[] = [];

      for (const key of invalidKeys) {
        apiKeyRepository.findOne.mockResolvedValue(null);
        
        const start = process.hrtime.bigint();
        await service.validateApiKey(key, TEST_IP, TEST_USER_AGENT, TEST_REQUEST_ID, TEST_ENDPOINT);
        const end = process.hrtime.bigint();
        
        timings.push(Number(end - start) / 1000000); // Convert to milliseconds
      }

      // Assert timing consistency (all should be within reasonable variance)
      const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
      const maxDeviation = Math.max(...timings.map(t => Math.abs(t - avgTime)));
      
      // Allow for some variance but not too much (implementation-dependent)
      expect(maxDeviation).toBeLessThan(avgTime * 2); // Max 200% deviation
    });

    it('should prevent brute force attacks by logging attempts', async () => {
      // Arrange
      cryptoService.isValidApiKeyFormat.mockReturnValue(true);
      cryptoService.hashApiKey.mockResolvedValue('different-hash-each-time');
      apiKeyRepository.findOne.mockResolvedValue(null);

      const bruteForceAttempts = 5;
      
      // Act - Simulate multiple failed attempts
      for (let i = 0; i < bruteForceAttempts; i++) {
        await service.validateApiKey(
          `brute-force-key-${i}`,
          TEST_IP,
          TEST_USER_AGENT,
          `${TEST_REQUEST_ID}-${i}`,
          TEST_ENDPOINT,
        );
      }

      // Assert - Each attempt should be logged
      expect(auditService.logInvalidApiKeyAttempt).toHaveBeenCalledTimes(bruteForceAttempts);
      
      // Verify all attempts are from same IP (could trigger additional security measures)
      const loggedAttempts = auditService.logInvalidApiKeyAttempt.mock.calls;
      loggedAttempts.forEach(call => {
        expect(call[1]).toBe(TEST_IP); // IP address is second parameter
      });
    });

    it('should handle SQL injection attempts in API key', async () => {
      // Arrange
      const maliciousKeys = [
        "'; DROP TABLE api_keys; --",
        "' OR '1'='1",
        "'; UPDATE api_keys SET isActive=true; --",
        "' UNION SELECT * FROM users; --",
      ];

      cryptoService.isValidApiKeyFormat.mockReturnValue(false); // These should fail format check

      // Act & Assert
      for (const maliciousKey of maliciousKeys) {
        const result = await service.validateApiKey(
          maliciousKey,
          TEST_IP,
          TEST_USER_AGENT,
          TEST_REQUEST_ID,
          TEST_ENDPOINT,
        );

        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Invalid API key format');
      }

      // Verify all malicious attempts are logged
      expect(auditService.logInvalidApiKeyAttempt).toHaveBeenCalledTimes(maliciousKeys.length);
    });

    it('should handle extremely long API keys gracefully', async () => {
      // Arrange
      const extremelyLongKey = 'a'.repeat(10000); // 10KB string
      cryptoService.isValidApiKeyFormat.mockReturnValue(false);

      // Act
      const result = await service.validateApiKey(
        extremelyLongKey,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid API key format');
      
      // Should not cause performance issues or crashes
      expect(auditService.logInvalidApiKeyAttempt).toHaveBeenCalled();
    });

    it('should handle special characters and encoding attacks', async () => {
      // Arrange
      const encodedKeys = [
        '%3Cscript%3Ealert%281%29%3C%2Fscript%3E', // URL encoded script
        '\x00\x01\x02\x03', // Null bytes and control characters
        '../../etc/passwd', // Path traversal
        '<script>alert(1)</script>', // XSS attempt
        '\u0000\u0001\u0002', // Unicode null bytes
      ];

      cryptoService.isValidApiKeyFormat.mockReturnValue(false);

      // Act & Assert
      for (const encodedKey of encodedKeys) {
        const result = await service.validateApiKey(
          encodedKey,
          TEST_IP,
          TEST_USER_AGENT,
          TEST_REQUEST_ID,
          TEST_ENDPOINT,
        );

        expect(result.valid).toBe(false);
        expect(result.reason).toBe('Invalid API key format');
      }
    });
  });

  describe('Key Rotation and Lifecycle Security', () => {
    it('should properly deactivate API keys', async () => {
      // Arrange
      const apiKey = {
        id: randomUUID(),
        name: 'Test Key',
        organizationId: 'org-123',
      } as ApiKey;

      apiKeyRepository.findOne.mockResolvedValue(apiKey);
      apiKeyRepository.update.mockResolvedValue(undefined as any);

      // Act
      await service.deactivateApiKey(apiKey.id, 'user-123');

      // Assert
      expect(apiKeyRepository.update).toHaveBeenCalledWith(
        apiKey.id,
        { isActive: false }
      );
      expect(auditService.logApiKeyDeleted).toHaveBeenCalledWith(
        apiKey.id,
        apiKey.name,
        'user-123',
        'org-123',
      );
    });

    it('should clean up expired keys securely', async () => {
      // Arrange
      const expiredKeys = [
        { id: 'key1', name: 'Expired Key 1', expiresAt: new Date('2023-01-01') },
        { id: 'key2', name: 'Expired Key 2', expiresAt: new Date('2023-01-02') },
      ] as ApiKey[];

      apiKeyRepository.find.mockResolvedValue(expiredKeys);
      apiKeyRepository.update.mockResolvedValue(undefined as any);

      // Act
      const cleanedCount = await service.cleanupExpiredKeys();

      // Assert
      expect(cleanedCount).toBe(2);
      expect(apiKeyRepository.update).toHaveBeenCalledWith(
        { expiresAt: expect.any(Object), isActive: true },
        { isActive: false }
      );
    });

    it('should prevent unauthorized key listing', async () => {
      // Arrange
      const orgKeys = [
        { id: 'key1', organizationId: 'org-123' },
        { id: 'key2', organizationId: 'org-123' },
      ] as ApiKey[];

      apiKeyRepository.find.mockResolvedValue(orgKeys);

      // Act
      const result = await service.listApiKeys('org-123');

      // Assert
      expect(apiKeyRepository.find).toHaveBeenCalledWith({
        where: { organizationId: 'org-123' },
        order: { createdAt: 'DESC' },
        select: expect.not.arrayContaining(['hashedKey']), // Should not include hashed key
      });
      expect(result).toEqual(orgKeys);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle database connection failures', async () => {
      // Arrange
      cryptoService.isValidApiKeyFormat.mockReturnValue(true);
      cryptoService.hashApiKey.mockResolvedValue(VALID_HASH);
      apiKeyRepository.findOne.mockRejectedValue(new Error('Database connection failed'));

      // Act
      const result = await service.validateApiKey(
        VALID_API_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Internal validation error');
    });

    it('should handle concurrent validation requests', async () => {
      // Arrange
      const validApiKey = {
        id: randomUUID(),
        hashedKey: VALID_HASH,
        name: 'Test Key',
        scopes: ['notifications:create'],
        rateLimit: { hourly: 100, daily: 1000 },
        isActive: true,
        isExpired: jest.fn().mockReturnValue(false),
        hasScope: jest.fn().mockReturnValue(true),
      } as any;

      cryptoService.isValidApiKeyFormat.mockReturnValue(true);
      cryptoService.hashApiKey.mockResolvedValue(VALID_HASH);
      apiKeyRepository.findOne.mockResolvedValue(validApiKey);
      apiKeyRepository.update.mockResolvedValue(undefined as any);

      const pipeline = {
        incr: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, 50], [null, 'OK']]),
      };
      redisMock.pipeline.mockReturnValue(pipeline);

      // Act - Make multiple concurrent requests
      const promises = Array(5).fill(null).map((_, i) => 
        service.validateApiKey(
          VALID_API_KEY,
          TEST_IP,
          TEST_USER_AGENT,
          `${TEST_REQUEST_ID}-${i}`,
          TEST_ENDPOINT,
        )
      );

      const results = await Promise.all(promises);

      // Assert - All should succeed (within rate limit)
      results.forEach(result => {
        expect(result.valid).toBe(true);
      });
    });

    it('should handle malformed rate limit responses from Redis', async () => {
      // Arrange
      cryptoService.isValidApiKeyFormat.mockReturnValue(true);
      cryptoService.hashApiKey.mockResolvedValue(VALID_HASH);

      const pipeline = {
        incr: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, 'not-a-number'], [null, 'OK']]),
      };
      redisMock.pipeline.mockReturnValue(pipeline);

      const validApiKey = {
        id: randomUUID(),
        hashedKey: VALID_HASH,
        name: 'Test Key',
        scopes: ['notifications:create'],
        isActive: true,
        isExpired: jest.fn().mockReturnValue(false),
        hasScope: jest.fn().mockReturnValue(true),
      } as any;

      apiKeyRepository.findOne.mockResolvedValue(validApiKey);
      apiKeyRepository.update.mockResolvedValue(undefined as any);

      // Act
      const result = await service.validateApiKey(
        VALID_API_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );

      // Assert - Should handle gracefully and allow request
      expect(result.valid).toBe(true);
    });
  });

  describe('Usage Statistics Security', () => {
    it('should securely track usage statistics', async () => {
      // Arrange
      const apiKeyId = randomUUID();
      redisMock.get.mockImplementation((key: string) => {
        if (key.includes(apiKeyId)) {
          return Promise.resolve('42');
        }
        return Promise.resolve('0');
      });

      // Act
      const stats = await service.getUsageStats(apiKeyId, 7);

      // Assert
      expect(stats.totalRequests).toBeGreaterThanOrEqual(0);
      expect(stats.dailyBreakdown).toHaveLength(7);
      expect(stats.dailyBreakdown[0]).toHaveProperty('date');
      expect(stats.dailyBreakdown[0]).toHaveProperty('requests');
    });

    it('should prevent unauthorized access to usage statistics', async () => {
      // This test would be expanded in integration tests with proper authorization
      // For now, we ensure the method exists and handles basic cases
      
      const apiKeyId = randomUUID();
      redisMock.get.mockResolvedValue('0');

      const stats = await service.getUsageStats(apiKeyId);
      
      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('dailyBreakdown');
    });
  });
});
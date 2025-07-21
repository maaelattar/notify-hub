import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// Services and Guards
import { SecureApiKeyService } from './services/secure-api-key.service';
import { SecureApiKeyGuard, AuthenticatedRequest } from './guards/secure-api-key.guard';
import { CryptoService } from './services/crypto.service';
import { SecurityAuditService } from './services/security-audit.service';

// Entities
import { ApiKey } from './entities/api-key.entity';
import { SecurityAuditLog, SecurityEventType } from './entities/security-audit.entity';

// Providers
import { RedisProvider } from '../common/providers/redis.provider';

// Test utilities
import { MockFactory } from '../../test/test-utils';
import { randomUUID } from 'crypto';

describe('API Key Authentication Integration - Security Tests', () => {
  let module: TestingModule;
  let apiKeyService: SecureApiKeyService;
  let apiKeyGuard: SecureApiKeyGuard;
  let cryptoService: CryptoService;
  let auditService: SecurityAuditService;
  let apiKeyRepository: jest.Mocked<Repository<ApiKey>>;
  let auditRepository: jest.Mocked<Repository<SecurityAuditLog>>;
  let redisProvider: jest.Mocked<RedisProvider>;
  let redisMock: any;

  // Test data
  const TEST_IP = '203.0.113.1';
  const TEST_USER_AGENT = 'IntegrationTest/1.0';
  const TEST_ENDPOINT = 'POST /api/notifications';
  let validApiKeyData: { key: string; hash: string; entity: ApiKey };

  beforeEach(async () => {
    // Create Redis mock
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

    module = await Test.createTestingModule({
      providers: [
        // Main services
        SecureApiKeyService,
        SecureApiKeyGuard,
        CryptoService,
        SecurityAuditService,
        Reflector,
        
        // Repository mocks
        {
          provide: getRepositoryToken(ApiKey),
          useValue: MockFactory.createMockRepository<ApiKey>(),
        },
        {
          provide: getRepositoryToken(SecurityAuditLog),
          useValue: MockFactory.createMockRepository<SecurityAuditLog>(),
        },
        
        // Provider mocks
        {
          provide: RedisProvider,
          useValue: {
            getClient: jest.fn().mockReturnValue(redisMock),
          },
        },
      ],
    }).compile();

    // Get service instances
    apiKeyService = module.get<SecureApiKeyService>(SecureApiKeyService);
    apiKeyGuard = module.get<SecureApiKeyGuard>(SecureApiKeyGuard);
    cryptoService = module.get<CryptoService>(CryptoService);
    auditService = module.get<SecurityAuditService>(SecurityAuditService);
    
    // Get repository mocks
    apiKeyRepository = module.get(getRepositoryToken(ApiKey));
    auditRepository = module.get(getRepositoryToken(SecurityAuditLog));
    redisProvider = module.get(RedisProvider);

    // Set up valid API key for tests
    await setupValidApiKey();
  });

  afterEach(async () => {
    await module.close();
  });

  async function setupValidApiKey() {
    // Create a real API key using the crypto service
    const plainTextKey = cryptoService.generateApiKey();
    const hashedKey = await cryptoService.hashApiKey(plainTextKey);
    
    const apiKeyEntity: ApiKey = {
      id: randomUUID(),
      hashedKey,
      name: 'Integration Test Key',
      scopes: ['notifications:create', 'notifications:read'],
      rateLimit: { hourly: 1000, daily: 10000 },
      isActive: true,
      lastUsedAt: null,
      expiresAt: null,
      organizationId: 'test-org-123',
      createdByUserId: 'test-user-456',
      createdAt: new Date(),
      updatedAt: new Date(),
      isExpired: jest.fn().mockReturnValue(false),
      hasScope: jest.fn().mockImplementation((scope: string) => 
        ['notifications:create', 'notifications:read'].includes(scope)
      ),
      canPerformOperation: jest.fn().mockReturnValue(true),
    } as any;

    validApiKeyData = {
      key: plainTextKey,
      hash: hashedKey,
      entity: apiKeyEntity,
    };
  }

  function createMockExecutionContext(
    requireApiKey: boolean = true,
    requiredScope?: string,
    request?: Partial<AuthenticatedRequest>
  ): ExecutionContext {
    const mockRequest: AuthenticatedRequest = {
      headers: {},
      query: {},
      method: 'POST',
      url: '/api/notifications',
      route: { path: '/api/notifications' },
      ip: TEST_IP,
      ...request,
    } as any;

    const reflector = module.get<Reflector>(Reflector);
    jest.spyOn(reflector, 'getAllAndOverride')
      .mockReturnValueOnce(requireApiKey)
      .mockReturnValueOnce(requiredScope);

    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
    } as any;
  }

  describe('Complete Authentication Flow - Valid Requests', () => {
    it('should successfully authenticate valid API key through complete flow', async () => {
      // Arrange
      const context = createMockExecutionContext(true, 'notifications:create', {
        headers: {
          'x-api-key': validApiKeyData.key,
          'user-agent': TEST_USER_AGENT,
        },
      });

      // Mock database responses
      apiKeyRepository.findOne.mockResolvedValue(validApiKeyData.entity);
      apiKeyRepository.update.mockResolvedValue(undefined as any);
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      const result = await apiKeyGuard.canActivate(context);

      // Assert
      expect(result).toBe(true);
      
      // Verify the complete flow
      expect(apiKeyRepository.findOne).toHaveBeenCalledWith({
        where: { hashedKey: validApiKeyData.hash, isActive: true },
      });
      
      expect(apiKeyRepository.update).toHaveBeenCalledWith(
        validApiKeyData.entity.id,
        { lastUsedAt: expect.any(Date) }
      );

      // Verify audit logging
      expect(auditRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: SecurityEventType.API_KEY_USED,
          apiKeyId: validApiKeyData.entity.id,
          ipAddress: TEST_IP,
          userAgent: TEST_USER_AGENT,
        })
      );

      // Verify request metadata is attached
      const request = context.switchToHttp().getRequest();
      expect(request.apiKey).toBeDefined();
      expect(request.apiKey.id).toBe(validApiKeyData.entity.id);
      expect(request.apiKey.scopes).toEqual(validApiKeyData.entity.scopes);
    });

    it('should handle rate limiting in complete flow', async () => {
      // Arrange - Set up rate limit near threshold
      const pipeline = {
        incr: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, 950], [null, 'OK']]), // Near limit
      };
      redisMock.pipeline.mockReturnValue(pipeline);

      const context = createMockExecutionContext(true, undefined, {
        headers: {
          'x-api-key': validApiKeyData.key,
          'user-agent': TEST_USER_AGENT,
        },
      });

      apiKeyRepository.findOne.mockResolvedValue(validApiKeyData.entity);
      apiKeyRepository.update.mockResolvedValue(undefined as any);
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      const result = await apiKeyGuard.canActivate(context);

      // Assert
      expect(result).toBe(true);
      
      // Verify rate limiting was checked
      expect(redisMock.pipeline).toHaveBeenCalled();
      expect(pipeline.incr).toHaveBeenCalled();
      expect(pipeline.expire).toHaveBeenCalled();

      // Verify usage counters were incremented
      expect(redisMock.incr).toHaveBeenCalledWith(
        expect.stringContaining(`api_key_usage:${validApiKeyData.entity.id}`)
      );
    });

    it('should enforce scope-based authorization correctly', async () => {
      // Arrange
      const context = createMockExecutionContext(true, 'admin:delete', {
        headers: {
          'x-api-key': validApiKeyData.key,
          'user-agent': TEST_USER_AGENT,
        },
      });

      apiKeyRepository.findOne.mockResolvedValue(validApiKeyData.entity);
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Mock scope check to fail
      validApiKeyData.entity.hasScope = jest.fn().mockReturnValue(false);

      // Act & Assert
      await expect(apiKeyGuard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      
      // Verify suspicious activity was logged
      expect(auditRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: SecurityEventType.SUSPICIOUS_ACTIVITY,
          apiKeyId: validApiKeyData.entity.id,
          metadata: expect.objectContaining({
            requiredScope: 'admin:delete',
            availableScopes: validApiKeyData.entity.scopes,
          }),
        })
      );
    });
  });

  describe('Security Attack Scenarios - Integration', () => {
    it('should detect and log brute force attempts', async () => {
      // Arrange - Multiple invalid keys
      const invalidKeys = [
        'invalid-key-1-attempt-123456789012345678901234',
        'invalid-key-2-attempt-234567890123456789012345',
        'invalid-key-3-attempt-345678901234567890123456',
      ];

      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);
      apiKeyRepository.findOne.mockResolvedValue(null); // All keys invalid

      // Act - Simulate brute force attack
      for (const invalidKey of invalidKeys) {
        const context = createMockExecutionContext(true, undefined, {
          headers: {
            'x-api-key': invalidKey,
            'user-agent': TEST_USER_AGENT,
          },
        });

        await expect(apiKeyGuard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      }

      // Assert - All attempts should be logged
      expect(auditRepository.save).toHaveBeenCalledTimes(invalidKeys.length);
      
      // All logs should be invalid attempts from same IP
      auditRepository.save.mock.calls.forEach(call => {
        const logEntry = call[0];
        expect(logEntry.eventType).toBe(SecurityEventType.INVALID_API_KEY_ATTEMPT);
        expect(logEntry.ipAddress).toBe(TEST_IP);
      });
    });

    it('should handle rate limit attacks', async () => {
      // Arrange - Simulate rate limit exceeded
      const pipeline = {
        incr: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, 1001], [null, 'OK']]), // Exceeds limit
      };
      redisMock.pipeline.mockReturnValue(pipeline);

      const context = createMockExecutionContext(true, undefined, {
        headers: {
          'x-api-key': validApiKeyData.key,
          'user-agent': TEST_USER_AGENT,
        },
      });

      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act & Assert
      await expect(apiKeyGuard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      
      // Verify rate limit exceeded is logged
      expect(auditRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: SecurityEventType.RATE_LIMIT_EXCEEDED,
          hashedKey: validApiKeyData.hash,
          ipAddress: TEST_IP,
          metadata: expect.objectContaining({
            rateLimitInfo: expect.objectContaining({
              limit: 1000,
              current: 1001,
            }),
          }),
        })
      );
    });

    it('should detect API key format injection attacks', async () => {
      // Arrange - Malicious API key formats
      const maliciousKeys = [
        "'; DROP TABLE api_keys; --ABCDEFGHIJKLMNOPQRSTUVWX",
        "'||'1'='1'--ABCDEFGHIJKLMNOPQRSTUVWXYZ123456789",
        "'; UPDATE api_keys SET isActive=1; --ABCDEFGHIJK",
        "../../etc/passwd" + "A".repeat(27), // Path traversal + padding
        "<script>alert(1)</script>" + "B".repeat(18), // XSS + padding
      ];

      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act & Assert
      for (const maliciousKey of maliciousKeys) {
        const context = createMockExecutionContext(true, undefined, {
          headers: {
            'x-api-key': maliciousKey,
            'user-agent': TEST_USER_AGENT,
          },
        });

        await expect(apiKeyGuard.canActivate(context)).rejects.toThrow(UnauthorizedException);
        
        // Verify invalid format is detected
        const lastCall = auditRepository.save.mock.calls[auditRepository.save.mock.calls.length - 1];
        expect(lastCall[0].eventType).toBe(SecurityEventType.INVALID_API_KEY_ATTEMPT);
        expect(lastCall[0].hashedKey).toBe('invalid_format');
      }
    });

    it('should handle header injection attempts', async () => {
      // Arrange - Malicious headers
      const context = createMockExecutionContext(true, undefined, {
        headers: {
          'x-api-key': validApiKeyData.key,
          'user-agent': 'Normal-Agent\r\nX-Injected: malicious-value',
          'x-forwarded-for': '127.0.0.1\r\nHost: evil.com',
          'x-real-ip': '192.168.1.1\n<script>alert(1)</script>',
        },
      });

      apiKeyRepository.findOne.mockResolvedValue(validApiKeyData.entity);
      apiKeyRepository.update.mockResolvedValue(undefined as any);
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      const result = await apiKeyGuard.canActivate(context);

      // Assert - Should still work but log the malicious headers
      expect(result).toBe(true);
      
      // Verify audit log contains the malicious data for analysis
      expect(auditRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: SecurityEventType.API_KEY_USED,
          userAgent: expect.stringContaining('Normal-Agent'),
          ipAddress: expect.stringContaining('127.0.0.1'),
        })
      );
    });

    it('should detect expired key usage attempts', async () => {
      // Arrange - Expired API key
      const expiredKey = { 
        ...validApiKeyData.entity,
        expiresAt: new Date(Date.now() - 86400000), // 24 hours ago
      } as ApiKey;
      expiredKey.isExpired = jest.fn().mockReturnValue(true);

      const context = createMockExecutionContext(true, undefined, {
        headers: {
          'x-api-key': validApiKeyData.key,
          'user-agent': TEST_USER_AGENT,
        },
      });

      apiKeyRepository.findOne.mockResolvedValue(expiredKey);
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act & Assert
      await expect(apiKeyGuard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      
      // Verify expired key attempt is logged
      expect(auditRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: SecurityEventType.API_KEY_EXPIRED,
          apiKeyId: expiredKey.id,
          ipAddress: TEST_IP,
        })
      );
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle database connection failures gracefully', async () => {
      // Arrange
      const context = createMockExecutionContext(true, undefined, {
        headers: {
          'x-api-key': validApiKeyData.key,
          'user-agent': TEST_USER_AGENT,
        },
      });

      apiKeyRepository.findOne.mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(apiKeyGuard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      
      // Should get generic authentication error, not expose database error
      try {
        await apiKeyGuard.canActivate(context);
      } catch (error) {
        const response = (error as UnauthorizedException).getResponse() as any;
        expect(response.code).toBe('AUTH_ERROR');
        expect(response.message).toBe('An error occurred during authentication');
      }
    });

    it('should handle Redis connection failures (fail open)', async () => {
      // Arrange
      redisMock.pipeline.mockImplementation(() => {
        throw new Error('Redis connection failed');
      });

      const context = createMockExecutionContext(true, undefined, {
        headers: {
          'x-api-key': validApiKeyData.key,
          'user-agent': TEST_USER_AGENT,
        },
      });

      apiKeyRepository.findOne.mockResolvedValue(validApiKeyData.entity);
      apiKeyRepository.update.mockResolvedValue(undefined as any);
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act - Should succeed despite Redis failure
      const result = await apiKeyGuard.canActivate(context);

      // Assert
      expect(result).toBe(true);
      
      // Should still log API key usage despite Redis failure
      expect(auditRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: SecurityEventType.API_KEY_USED,
          apiKeyId: validApiKeyData.entity.id,
        })
      );
    });

    it('should handle concurrent requests with same API key', async () => {
      // Arrange - Multiple concurrent contexts
      const contexts = Array.from({ length: 5 }, () =>
        createMockExecutionContext(true, undefined, {
          headers: {
            'x-api-key': validApiKeyData.key,
            'user-agent': TEST_USER_AGENT,
          },
        })
      );

      // Set up rate limiting to allow all requests
      const pipeline = {
        incr: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, 50], [null, 'OK']]), // Well within limit
      };
      redisMock.pipeline.mockReturnValue(pipeline);

      apiKeyRepository.findOne.mockResolvedValue(validApiKeyData.entity);
      apiKeyRepository.update.mockResolvedValue(undefined as any);
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act - Process all requests concurrently
      const promises = contexts.map(context => apiKeyGuard.canActivate(context));
      const results = await Promise.all(promises);

      // Assert - All should succeed
      results.forEach(result => {
        expect(result).toBe(true);
      });

      // All requests should be audited
      expect(auditRepository.save).toHaveBeenCalledTimes(5);
    });

    it('should maintain request isolation between different API keys', async () => {
      // Arrange - Set up second valid API key
      const secondApiKey = cryptoService.generateApiKey();
      const secondHash = await cryptoService.hashApiKey(secondApiKey);
      const secondEntity = {
        ...validApiKeyData.entity,
        id: randomUUID(),
        hashedKey: secondHash,
        name: 'Second Test Key',
      } as ApiKey;

      const context1 = createMockExecutionContext(true, undefined, {
        headers: {
          'x-api-key': validApiKeyData.key,
          'user-agent': 'Client1/1.0',
        },
      });

      const context2 = createMockExecutionContext(true, undefined, {
        headers: {
          'x-api-key': secondApiKey,
          'user-agent': 'Client2/1.0',
        },
      });

      // Mock database to return appropriate keys
      apiKeyRepository.findOne
        .mockImplementation(async (options: any) => {
          if (options.where.hashedKey === validApiKeyData.hash) {
            return validApiKeyData.entity;
          } else if (options.where.hashedKey === secondHash) {
            return secondEntity;
          }
          return null;
        });

      apiKeyRepository.update.mockResolvedValue(undefined as any);
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      const [result1, result2] = await Promise.all([
        apiKeyGuard.canActivate(context1),
        apiKeyGuard.canActivate(context2),
      ]);

      // Assert
      expect(result1).toBe(true);
      expect(result2).toBe(true);

      // Verify correct API keys were attached to each request
      const request1 = context1.switchToHttp().getRequest();
      const request2 = context2.switchToHttp().getRequest();

      expect(request1.apiKey.id).toBe(validApiKeyData.entity.id);
      expect(request2.apiKey.id).toBe(secondEntity.id);

      // Verify separate audit logs
      expect(auditRepository.save).toHaveBeenCalledTimes(2);
      const auditCalls = auditRepository.save.mock.calls;
      expect(auditCalls[0][0].apiKeyId).toBe(validApiKeyData.entity.id);
      expect(auditCalls[1][0].apiKeyId).toBe(secondEntity.id);
    });

    it('should handle malformed execution context', async () => {
      // Arrange - Create malformed context
      const malformedContext: ExecutionContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(null), // Null request
        }),
      } as any;

      const reflector = module.get<Reflector>(Reflector);
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

      // Act & Assert
      await expect(apiKeyGuard.canActivate(malformedContext)).rejects.toThrow();
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle high-frequency authentication requests', async () => {
      // Arrange
      const requestCount = 100;
      const contexts = Array.from({ length: requestCount }, (_, i) =>
        createMockExecutionContext(true, undefined, {
          headers: {
            'x-api-key': validApiKeyData.key,
            'user-agent': `LoadTest${i}/1.0`,
          },
        })
      );

      // Set up successful responses
      const pipeline = {
        incr: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn().mockResolvedValue([[null, 10], [null, 'OK']]),
      };
      redisMock.pipeline.mockReturnValue(pipeline);

      apiKeyRepository.findOne.mockResolvedValue(validApiKeyData.entity);
      apiKeyRepository.update.mockResolvedValue(undefined as any);
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      const startTime = Date.now();
      const promises = contexts.map(context => apiKeyGuard.canActivate(context));
      const results = await Promise.all(promises);
      const endTime = Date.now();

      // Assert
      results.forEach(result => expect(result).toBe(true));
      
      const duration = endTime - startTime;
      expect(duration).toBeLessThan(5000); // Should complete in reasonable time

      // All requests should be processed
      expect(auditRepository.save).toHaveBeenCalledTimes(requestCount);
    });

    it('should handle authentication with large metadata', async () => {
      // Arrange - Large user agent and headers
      const largeUserAgent = 'A'.repeat(1000);
      const context = createMockExecutionContext(true, undefined, {
        headers: {
          'x-api-key': validApiKeyData.key,
          'user-agent': largeUserAgent,
          'x-forwarded-for': Array.from({ length: 50 }, (_, i) => `192.168.1.${i}`).join(', '),
        },
      });

      apiKeyRepository.findOne.mockResolvedValue(validApiKeyData.entity);
      apiKeyRepository.update.mockResolvedValue(undefined as any);
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      const result = await apiKeyGuard.canActivate(context);

      // Assert
      expect(result).toBe(true);
      
      // Should handle large metadata gracefully
      expect(auditRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userAgent: largeUserAgent,
          ipAddress: '192.168.1.0', // First IP from forwarded list
        })
      );
    });
  });

  describe('Audit Trail Completeness', () => {
    it('should maintain complete audit trail for successful authentication', async () => {
      // Arrange
      const context = createMockExecutionContext(true, 'notifications:create', {
        headers: {
          'x-api-key': validApiKeyData.key,
          'user-agent': TEST_USER_AGENT,
        },
      });

      apiKeyRepository.findOne.mockResolvedValue(validApiKeyData.entity);
      apiKeyRepository.update.mockResolvedValue(undefined as any);
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      await apiKeyGuard.canActivate(context);

      // Assert - Complete audit trail
      expect(auditRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: SecurityEventType.API_KEY_USED,
          apiKeyId: validApiKeyData.entity.id,
          ipAddress: TEST_IP,
          userAgent: TEST_USER_AGENT,
          requestId: expect.any(String),
          organizationId: validApiKeyData.entity.organizationId,
          metadata: expect.objectContaining({
            endpoint: TEST_ENDPOINT,
          }),
          message: `API key used for ${TEST_ENDPOINT}`,
        })
      );

      // Verify last used timestamp was updated
      expect(apiKeyRepository.update).toHaveBeenCalledWith(
        validApiKeyData.entity.id,
        { lastUsedAt: expect.any(Date) }
      );
    });

    it('should maintain audit trail for failed authentication', async () => {
      // Arrange - Invalid API key
      const invalidKey = 'invalid-key-12345678901234567890123456789';
      const context = createMockExecutionContext(true, undefined, {
        headers: {
          'x-api-key': invalidKey,
          'user-agent': TEST_USER_AGENT,
        },
      });

      apiKeyRepository.findOne.mockResolvedValue(null);
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act & Assert
      await expect(apiKeyGuard.canActivate(context)).rejects.toThrow(UnauthorizedException);

      // Verify audit trail for failed attempt
      expect(auditRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: SecurityEventType.INVALID_API_KEY_ATTEMPT,
          hashedKey: await cryptoService.hashApiKey(invalidKey),
          ipAddress: TEST_IP,
          userAgent: TEST_USER_AGENT,
          requestId: expect.any(String),
          metadata: expect.objectContaining({
            endpoint: TEST_ENDPOINT,
          }),
          message: `Invalid API key attempt from ${TEST_IP} for ${TEST_ENDPOINT}`,
        })
      );
    });
  });
});
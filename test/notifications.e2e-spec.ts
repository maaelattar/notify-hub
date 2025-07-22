import { vi, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';

import { NotificationsModule } from '../src/modules/notifications/notifications.module';
import { NotificationChannel } from '../src/modules/notifications/enums/notification-channel.enum';
import { NotificationStatus } from '../src/modules/notifications/enums/notification-status.enum';
import { NotificationPriority } from '../src/modules/notifications/enums/notification-priority.enum';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { ErrorGuidanceFactory } from '../src/common/services/error-guidance.factory';
import { CorrelationIdMiddleware } from '../src/modules/security/middleware/correlation-id.middleware';
import { LoggingInterceptor } from '../src/common/interceptors/logging.interceptor';
import { ApiVersionInterceptor } from '../src/common/interceptors/api-version.interceptor';

import { TestEnvironment, TestDateUtils } from '../src/test/test-utils';

describe('Notifications (E2E)', () => {
  let app: INestApplication;
  let httpServer: any;

  beforeAll(async () => {
    // Set test environment
    TestEnvironment.setTestEnvironment();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: '.env.test',
        }),
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [__dirname + '/../src/**/*.entity{.ts,.js}'],
          synchronize: true,
          dropSchema: true,
          logging: false,
        }),
        ThrottlerModule.forRoot([
          {
            name: 'short',
            ttl: 1000,
            limit: 3,
          },
          {
            name: 'long',
            ttl: 60000,
            limit: 100,
          },
        ]),
        NotificationsModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Configure the app with the same middleware/interceptors as production
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );

    const mockErrorGuidanceFactory = {
      createGuidance: vi.fn().mockReturnValue(null),
    } as unknown as ErrorGuidanceFactory;
    app.useGlobalFilters(new GlobalExceptionFilter(mockErrorGuidanceFactory));
    app.useGlobalInterceptors(
      new LoggingInterceptor(),
      new ApiVersionInterceptor(),
    );

    // Add correlation ID middleware
    const correlationMiddleware = new CorrelationIdMiddleware();
    app.use((req: any, res: any, next: any) =>
      correlationMiddleware.use(req, res, next),
    );

    await app.init();
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /notifications', () => {
    it('should create an email notification successfully', async () => {
      // Arrange
      const createDto = {
        channel: NotificationChannel.EMAIL,
        recipient: 'test@example.com',
        subject: 'E2E Test Notification',
        content: 'This is a test notification for E2E testing',
        priority: NotificationPriority.NORMAL,
        metadata: {
          source: 'e2e-test',
          testId: 'create-email-001',
        },
      };

      // Act & Assert
      const response = await request(httpServer)
        .post('/notifications')
        .send(createDto)
        .expect(201);

      // Verify response structure
      expect(response.body).toMatchObject({
        id: expect.any(String),
        channel: NotificationChannel.EMAIL,
        recipient: 'test@example.com',
        subject: 'E2E Test Notification',
        content: 'This is a test notification for E2E testing',
        priority: NotificationPriority.NORMAL,
        status: expect.any(String),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        metadata: expect.objectContaining({
          source: 'e2e-test',
          testId: 'create-email-001',
        }),
      });

      // Verify headers
      expect(response.headers['x-request-id']).toBeDefined();
      expect(response.headers['x-api-version']).toBe('1.0');
    });

    it('should create a scheduled notification', async () => {
      // Arrange
      const scheduledFor = TestDateUtils.futureDate(60); // 1 hour from now
      const createDto = {
        channel: NotificationChannel.EMAIL,
        recipient: 'scheduled@example.com',
        subject: 'Scheduled Test',
        content: 'This notification is scheduled for later',
        scheduledFor: scheduledFor.toISOString(),
        metadata: {
          testType: 'scheduled',
        },
      };

      // Act & Assert
      const response = await request(httpServer)
        .post('/notifications')
        .send(createDto)
        .expect(201);

      expect(response.body.scheduledFor).toBeDefined();
      expect(new Date(response.body.scheduledFor)).toEqual(scheduledFor);
    });

    it('should validate input and return 400 for invalid data', async () => {
      // Arrange
      const invalidDto = {
        channel: 'INVALID_CHANNEL',
        recipient: 'not-an-email',
        subject: '', // Empty subject
        // Missing required content field
      };

      // Act & Assert
      const response = await request(httpServer)
        .post('/notifications')
        .send(invalidDto)
        .expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        message: expect.any(String),
        error: 'Bad Request',
      });
    });

    it('should handle rate limiting', async () => {
      // Arrange
      const createDto = {
        channel: NotificationChannel.EMAIL,
        recipient: 'ratelimit@example.com',
        subject: 'Rate Limit Test',
        content: 'Testing rate limiting',
      };

      // Act - Make requests up to the limit
      for (let i = 0; i < 3; i++) {
        await request(httpServer)
          .post('/notifications')
          .send({
            ...createDto,
            recipient: `ratelimit${i}@example.com`,
          })
          .expect(201);
      }

      // Assert - Next request should be rate limited
      const response = await request(httpServer)
        .post('/notifications')
        .send(createDto)
        .expect(429);

      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  describe('GET /notifications', () => {
    // Track created notifications for cleanup
    const createdNotificationIds: string[] = [];

    beforeAll(async () => {
      // Create test notifications
      const notifications = [
        {
          channel: NotificationChannel.EMAIL,
          recipient: 'list1@example.com',
          subject: 'List Test 1',
          content: 'Content 1',
          priority: NotificationPriority.HIGH,
        },
        {
          channel: NotificationChannel.EMAIL,
          recipient: 'list2@example.com',
          subject: 'List Test 2',
          content: 'Content 2',
          priority: NotificationPriority.NORMAL,
        },
        {
          channel: NotificationChannel.EMAIL,
          recipient: 'list3@example.com',
          subject: 'List Test 3',
          content: 'Content 3',
          priority: NotificationPriority.LOW,
        },
      ];

      for (const notification of notifications) {
        const response = await request(httpServer)
          .post('/notifications')
          .send(notification)
          .expect(201);
        createdNotificationIds.push(response.body.id);
      }
    });

    it('should return paginated notifications', async () => {
      // Act & Assert
      const response = await request(httpServer)
        .get('/notifications')
        .query({ page: 1, limit: 2 })
        .expect(200);

      expect(response.body).toMatchObject({
        data: expect.any(Array),
        total: expect.any(Number),
        page: 1,
        limit: 2,
        totalPages: expect.any(Number),
        hasNext: expect.any(Boolean),
        hasPrevious: false,
      });

      expect(response.body.data.length).toBeLessThanOrEqual(2);
    });

    it('should filter notifications by channel', async () => {
      // Act & Assert
      const response = await request(httpServer)
        .get('/notifications')
        .query({ channel: NotificationChannel.EMAIL })
        .expect(200);

      response.body.data.forEach((notification: any) => {
        expect(notification.channel).toBe(NotificationChannel.EMAIL);
      });
    });

    it('should filter notifications by recipient', async () => {
      // Act & Assert
      const response = await request(httpServer)
        .get('/notifications')
        .query({ recipient: 'list1@example.com' })
        .expect(200);

      response.body.data.forEach((notification: any) => {
        expect(notification.recipient).toBe('list1@example.com');
      });
    });
  });

  describe('GET /notifications/:id', () => {
    let notificationId: string;

    beforeAll(async () => {
      // Create a test notification
      const createResponse = await request(httpServer)
        .post('/notifications')
        .send({
          channel: NotificationChannel.EMAIL,
          recipient: 'getone@example.com',
          subject: 'Get One Test',
          content: 'Test content for get one',
        })
        .expect(201);

      notificationId = createResponse.body.id;
    });

    it('should return a notification by ID', async () => {
      // Act & Assert
      const response = await request(httpServer)
        .get(`/notifications/${notificationId}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: notificationId,
        channel: NotificationChannel.EMAIL,
        recipient: 'getone@example.com',
        subject: 'Get One Test',
        content: 'Test content for get one',
      });
    });

    it('should return 404 for non-existent notification', async () => {
      // Arrange
      const nonExistentId = '550e8400-e29b-41d4-a716-446655440000';

      // Act & Assert
      const response = await request(httpServer)
        .get(`/notifications/${nonExistentId}`)
        .expect(404);

      expect(response.body).toMatchObject({
        statusCode: 404,
        message: expect.stringContaining('not found'),
      });
    });

    it('should return 400 for invalid UUID format', async () => {
      // Act & Assert
      await request(httpServer).get('/notifications/invalid-uuid').expect(400);
    });
  });

  describe('PATCH /notifications/:id', () => {
    let notificationId: string;

    beforeEach(async () => {
      // Create a fresh notification for each test
      const createResponse = await request(httpServer)
        .post('/notifications')
        .send({
          channel: NotificationChannel.EMAIL,
          recipient: 'update@example.com',
          subject: 'Original Subject',
          content: 'Original content',
        })
        .expect(201);

      notificationId = createResponse.body.id;
    });

    it('should update notification successfully', async () => {
      // Arrange
      const updateDto = {
        subject: 'Updated Subject',
        content: 'Updated content',
        metadata: {
          updated: true,
          timestamp: new Date().toISOString(),
        },
      };

      // Act & Assert
      const response = await request(httpServer)
        .patch(`/notifications/${notificationId}`)
        .send(updateDto)
        .expect(200);

      expect(response.body).toMatchObject({
        id: notificationId,
        subject: 'Updated Subject',
        content: 'Updated content',
        metadata: expect.objectContaining({
          updated: true,
        }),
      });
    });

    it('should validate update data', async () => {
      // Arrange
      const invalidUpdate = {
        subject: '', // Empty subject should fail validation
        content: null, // Invalid content type
      };

      // Act & Assert
      await request(httpServer)
        .patch(`/notifications/${notificationId}`)
        .send(invalidUpdate)
        .expect(400);
    });
  });

  describe('DELETE /notifications/:id', () => {
    let notificationId: string;

    beforeEach(async () => {
      // Create a fresh notification for each test
      const createResponse = await request(httpServer)
        .post('/notifications')
        .send({
          channel: NotificationChannel.EMAIL,
          recipient: 'cancel@example.com',
          subject: 'To Be Cancelled',
          content: 'This notification will be cancelled',
        })
        .expect(201);

      notificationId = createResponse.body.id;
    });

    it('should cancel notification successfully', async () => {
      // Act & Assert
      const response = await request(httpServer)
        .delete(`/notifications/${notificationId}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: notificationId,
        status: NotificationStatus.CANCELLED,
      });
    });

    it('should return 404 for non-existent notification', async () => {
      // Arrange
      const nonExistentId = '550e8400-e29b-41d4-a716-446655440000';

      // Act & Assert
      await request(httpServer)
        .delete(`/notifications/${nonExistentId}`)
        .expect(404);
    });
  });

  describe('POST /notifications/:id/retry', () => {
    let failedNotificationId: string;

    beforeAll(async () => {
      // Create a notification that we can simulate as failed
      const createResponse = await request(httpServer)
        .post('/notifications')
        .send({
          channel: NotificationChannel.EMAIL,
          recipient: 'retry@example.com',
          subject: 'Retry Test',
          content: 'This will be retried',
        })
        .expect(201);

      failedNotificationId = createResponse.body.id;

      // Note: In a real E2E test, we would need to simulate the notification
      // processing and failure. For this example, we'll test the endpoint
      // even though the notification might not actually be in a failed state.
    });

    it('should handle retry request', async () => {
      // Act & Assert
      // This might return 400 if the notification is not in a retryable state
      // which is expected behavior
      const response = await request(httpServer)
        .post(`/notifications/${failedNotificationId}/retry`)
        .expect((res) => {
          expect([200, 400]).toContain(res.status);
        });

      if (response.status === 200) {
        expect(response.body).toMatchObject({
          id: failedNotificationId,
          status: expect.any(String),
        });
      } else {
        expect(response.body).toMatchObject({
          statusCode: 400,
          message: expect.any(String),
        });
      }
    });

    it('should return 404 for non-existent notification', async () => {
      // Arrange
      const nonExistentId = '550e8400-e29b-41d4-a716-446655440000';

      // Act & Assert
      await request(httpServer)
        .post(`/notifications/${nonExistentId}/retry`)
        .expect(404);
    });
  });

  describe('GET /notifications/stats/overview', () => {
    it('should return notification statistics', async () => {
      // Act & Assert
      const response = await request(httpServer)
        .get('/notifications/stats/overview')
        .expect(200);

      expect(response.body).toMatchObject({
        statusCounts: expect.any(Object),
        channelCounts: expect.any(Object),
        totalNotifications: expect.any(Number),
        successRate: expect.any(Number),
        recentFailureCount: expect.any(Number),
        recentFailures: expect.any(Array),
      });

      // Verify status counts structure
      expect(response.body.statusCounts).toMatchObject({
        created: expect.any(Number),
        queued: expect.any(Number),
        sent: expect.any(Number),
        delivered: expect.any(Number),
        failed: expect.any(Number),
        cancelled: expect.any(Number),
      });
    });

    it('should accept date range parameters', async () => {
      // Act & Assert
      const response = await request(httpServer)
        .get('/notifications/stats/overview')
        .query({
          from: '2023-01-01T00:00:00Z',
          to: '2023-12-31T23:59:59Z',
        })
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('GET /notifications/health/status', () => {
    it('should return health status', async () => {
      // Act & Assert
      const response = await request(httpServer)
        .get('/notifications/health/status')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        service: 'notifications',
      });

      // Verify timestamp is valid
      expect(new Date(response.body.timestamp).toISOString()).toBe(
        response.body.timestamp,
      );
    });

    it('should not be rate limited', async () => {
      // Act - Make multiple requests quickly
      for (let i = 0; i < 10; i++) {
        await request(httpServer)
          .get('/notifications/health/status')
          .expect(200);
      }

      // All requests should succeed (no rate limiting on health checks)
    });
  });

  describe('POST /notifications/test/email', () => {
    it('should create test email in development mode', async () => {
      // Arrange
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      // Act & Assert
      const response = await request(httpServer)
        .post('/notifications/test/email')
        .send({ email: 'test-e2e@example.com' })
        .expect(201);

      expect(response.body).toMatchObject({
        message: 'Test notification created',
        notificationId: expect.any(String),
        checkStatusAt: expect.stringContaining('/notifications/'),
      });

      // Cleanup
      process.env.NODE_ENV = originalEnv;
    });

    it('should reject test email in production mode', async () => {
      // Arrange
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      // Act & Assert
      await request(httpServer)
        .post('/notifications/test/email')
        .send({ email: 'test@example.com' })
        .expect(400);

      // Cleanup
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle malformed JSON gracefully', async () => {
      // Act & Assert
      const response = await request(httpServer)
        .post('/notifications')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        message: expect.any(String),
      });
    });

    it('should include correlation ID in responses', async () => {
      // Arrange
      const correlationId = 'test-correlation-id-123';

      // Act
      const response = await request(httpServer)
        .post('/notifications')
        .set('X-Correlation-ID', correlationId)
        .send({
          channel: NotificationChannel.EMAIL,
          recipient: 'correlation@example.com',
          subject: 'Correlation Test',
          content: 'Testing correlation ID',
        })
        .expect(201);

      // Assert
      expect(response.headers['x-correlation-id']).toBe(correlationId);
    });

    it('should handle very large request bodies', async () => {
      // Arrange
      const largeContent = 'x'.repeat(10000); // 10KB content

      // Act & Assert
      const response = await request(httpServer)
        .post('/notifications')
        .send({
          channel: NotificationChannel.EMAIL,
          recipient: 'large@example.com',
          subject: 'Large Content Test',
          content: largeContent,
        })
        .expect((res) => {
          // Should either succeed or fail with validation error
          expect([201, 400, 413]).toContain(res.status);
        });

      if (response.status === 201) {
        expect(response.body.content).toBe(largeContent);
      }
    });
  });

  describe('Complete Notification Lifecycle', () => {
    it('should handle complete CRUD lifecycle', async () => {
      // Create
      const createResponse = await request(httpServer)
        .post('/notifications')
        .send({
          channel: NotificationChannel.EMAIL,
          recipient: 'lifecycle@example.com',
          subject: 'Lifecycle Test',
          content: 'Initial content',
          metadata: { test: 'lifecycle' },
        })
        .expect(201);

      const notificationId = createResponse.body.id;

      // Read
      await request(httpServer)
        .get(`/notifications/${notificationId}`)
        .expect(200);

      // Update
      await request(httpServer)
        .patch(`/notifications/${notificationId}`)
        .send({
          subject: 'Updated Lifecycle Test',
          content: 'Updated content',
        })
        .expect(200);

      // Verify update
      const getAfterUpdate = await request(httpServer)
        .get(`/notifications/${notificationId}`)
        .expect(200);

      expect(getAfterUpdate.body.subject).toBe('Updated Lifecycle Test');

      // Cancel (Delete)
      await request(httpServer)
        .delete(`/notifications/${notificationId}`)
        .expect(200);

      // Verify cancellation
      const getAfterCancel = await request(httpServer)
        .get(`/notifications/${notificationId}`)
        .expect(200);

      expect(getAfterCancel.body.status).toBe(NotificationStatus.CANCELLED);
    });
  });
});

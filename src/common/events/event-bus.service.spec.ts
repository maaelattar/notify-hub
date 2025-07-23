import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventBusService } from './event-bus.service';
import {
  DomainEvent,
  EventHandler,
  NotificationCreatedEvent,
  NotificationFailedEvent,
  ChannelHealthChangedEvent,
} from './domain-events';
import { NotificationChannel } from '../../modules/notifications/enums/notification-channel.enum';
import { NotificationPriority } from '../../modules/notifications/enums/notification-priority.enum';

describe('EventBusService', () => {
  let service: EventBusService;
  let mockModuleRef: {
    container: {
      getModules: ReturnType<typeof vi.fn>;
    };
  };
  let mockEventEmitter: {
    emit: ReturnType<typeof vi.fn>;
    removeAllListeners: ReturnType<typeof vi.fn>;
  };
  let mockEventHandler: EventHandler;
  let mockEventHandler2: EventHandler;
  let testEvent: NotificationCreatedEvent;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create test event
    testEvent = {
      eventId: 'test-event-123',
      eventType: 'NotificationCreated',
      aggregateId: 'notification-456',
      aggregateType: 'Notification',
      version: 1,
      occurredAt: new Date('2023-01-01T12:00:00Z'),
      correlationId: 'correlation-789',
      causationId: 'causation-101',
      metadata: {
        userId: 'user-111',
        organizationId: 'org-222',
        source: 'NotifyHub',
      },
      payload: {
        notificationId: 'notification-456',
        channel: NotificationChannel.EMAIL,
        recipient: 'test@example.com',
        subject: 'Test Subject',
        content: 'Test content',
        priority: NotificationPriority.NORMAL,
        metadata: { key: 'value' },
      },
    };

    // Create mock event handlers
    mockEventHandler = {
      eventType: 'NotificationCreated',
      handle: vi.fn().mockResolvedValue(undefined),
      constructor: { name: 'MockEventHandler' },
    } as unknown as EventHandler;

    mockEventHandler2 = {
      eventType: 'NotificationCreated',
      handle: vi.fn().mockResolvedValue(undefined),
      constructor: { name: 'MockEventHandler2' },
    } as unknown as EventHandler;

    // Create mock EventEmitter2
    mockEventEmitter = {
      emit: vi.fn(),
      removeAllListeners: vi.fn(),
    };

    // Mock EventEmitter2 constructor
    vi.mocked(EventEmitter2).mockImplementation(() => mockEventEmitter as any);

    // Create mock module container structure
    const mockProviderWithHandler = {
      instance: mockEventHandler,
    };
    const mockProviderWithoutHandler = {
      instance: { someMethod: vi.fn() },
    };
    const mockProviderWithNullInstance = {
      instance: null,
    };

    const mockModule = {
      providers: new Map([
        ['handler1', mockProviderWithHandler],
        ['nonHandler', mockProviderWithoutHandler],
        ['nullProvider', mockProviderWithNullInstance],
      ]),
    };

    mockModuleRef = {
      container: {
        getModules: vi.fn().mockReturnValue(new Map([['testModule', mockModule]])),
      },
    };

    // Create service instance
    service = new EventBusService(mockModuleRef as unknown as ModuleRef);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct EventEmitter2 configuration', () => {
      expect(EventEmitter2).toHaveBeenCalledWith({
        wildcard: true,
        delimiter: '.',
        maxListeners: 100,
      });
    });
  });

  describe('onModuleInit', () => {
    it('should discover and register event handlers', () => {
      // Spy on the private method
      const discoverSpy = vi.spyOn(service as any, 'discoverAndRegisterHandlers');
      const loggerLogSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

      // Act
      service.onModuleInit();

      // Assert
      expect(discoverSpy).toHaveBeenCalled();
      expect(mockModuleRef.container.getModules).toHaveBeenCalled();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Event handler discovery completed. Registered 1 handlers.'
      );

      loggerLogSpy.mockRestore();
    });

    it('should handle discovery errors gracefully', () => {
      // Arrange
      mockModuleRef.container.getModules.mockImplementation(() => {
        throw new Error('Discovery failed');
      });

      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      service.onModuleInit();

      // Assert
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to discover event handlers', {
        error: 'Discovery failed',
      });

      loggerErrorSpy.mockRestore();
    });
  });

  describe('onModuleDestroy', () => {
    it('should cleanup event listeners and handlers', () => {
      // Arrange - register a handler first
      service.registerHandler(mockEventHandler);

      // Act
      service.onModuleDestroy();

      // Assert
      expect(mockEventEmitter.removeAllListeners).toHaveBeenCalled();
      // Verify handlers map is cleared by checking it's empty after cleanup
      expect((service as any).handlers.size).toBe(0);
    });
  });

  describe('publish', () => {
    it('should publish event successfully with registered handlers', async () => {
      // Arrange
      service.registerHandler(mockEventHandler);
      const loggerDebugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

      // Act
      await service.publish(testEvent);

      // Assert
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('NotificationCreated', testEvent);
      expect(mockEventHandler.handle).toHaveBeenCalledWith(testEvent);
      expect(loggerDebugSpy).toHaveBeenCalledWith('Publishing event: NotificationCreated', {
        eventId: 'test-event-123',
        aggregateId: 'notification-456',
        correlationId: 'correlation-789',
      });
      expect(loggerDebugSpy).toHaveBeenCalledWith('Event published successfully: NotificationCreated', {
        eventId: 'test-event-123',
        handlersCount: 1,
      });

      loggerDebugSpy.mockRestore();
    });

    it('should publish event successfully with no registered handlers', async () => {
      // Arrange
      const loggerDebugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

      // Act
      await service.publish(testEvent);

      // Assert
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('NotificationCreated', testEvent);
      expect(loggerDebugSpy).toHaveBeenCalledWith('No handlers registered for event: NotificationCreated');

      loggerDebugSpy.mockRestore();
    });

    it('should publish event with multiple handlers', async () => {
      // Arrange
      service.registerHandler(mockEventHandler);
      service.registerHandler(mockEventHandler2);

      // Act
      await service.publish(testEvent);

      // Assert
      expect(mockEventHandler.handle).toHaveBeenCalledWith(testEvent);
      expect(mockEventHandler2.handle).toHaveBeenCalledWith(testEvent);
    });

    it('should handle EventEmitter error and rethrow', async () => {
      // Arrange
      const error = new Error('EventEmitter failed');
      mockEventEmitter.emit.mockImplementation(() => {
        throw error;
      });

      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act & Assert
      await expect(service.publish(testEvent)).rejects.toThrow('EventEmitter failed');
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to publish event: NotificationCreated', {
        eventId: 'test-event-123',
        error: 'EventEmitter failed',
      });

      loggerErrorSpy.mockRestore();
    });

    it('should handle handler error and rethrow', async () => {
      // Arrange
      const handlerError = new Error('Handler execution failed');
      mockEventHandler.handle = vi.fn().mockRejectedValue(handlerError);
      service.registerHandler(mockEventHandler);

      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act & Assert
      await expect(service.publish(testEvent)).rejects.toThrow('Handler execution failed');
      expect(loggerErrorSpy).toHaveBeenCalledWith('Handler failed: MockEventHandler', {
        eventType: 'NotificationCreated',
        eventId: 'test-event-123',
        error: 'Handler execution failed',
      });

      loggerErrorSpy.mockRestore();
    });

    it('should handle non-Error exceptions in handlers', async () => {
      // Arrange
      mockEventHandler.handle = vi.fn().mockRejectedValue('String error');
      service.registerHandler(mockEventHandler);

      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act & Assert
      await expect(service.publish(testEvent)).rejects.toBe('String error');
      expect(loggerErrorSpy).toHaveBeenCalledWith('Handler failed: MockEventHandler', {
        eventType: 'NotificationCreated',
        eventId: 'test-event-123',
        error: 'Unknown error',
      });

      loggerErrorSpy.mockRestore();
    });

    it('should handle one handler failure among multiple handlers', async () => {
      // Arrange
      const failingHandler = {
        ...mockEventHandler2,
        handle: vi.fn().mockRejectedValue(new Error('Handler 2 failed')),
      };

      service.registerHandler(mockEventHandler);
      service.registerHandler(failingHandler);

      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act & Assert
      await expect(service.publish(testEvent)).rejects.toThrow('Handler 2 failed');
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'One or more handlers failed for event: NotificationCreated',
        {
          eventId: 'test-event-123',
          handlersCount: 2,
        }
      );

      loggerErrorSpy.mockRestore();
    });
  });

  describe('publishMany', () => {
    it('should publish multiple events successfully', async () => {
      // Arrange
      const event2: NotificationFailedEvent = {
        eventId: 'test-event-456',
        eventType: 'NotificationFailed',
        aggregateId: 'notification-789',
        aggregateType: 'Notification',
        version: 1,
        occurredAt: new Date('2023-01-01T12:05:00Z'),
        metadata: { source: 'NotifyHub' },
        payload: {
          notificationId: 'notification-789',
          channel: NotificationChannel.SMS,
          recipient: '+1234567890',
          failedAt: new Date('2023-01-01T12:05:00Z'),
          error: {
            code: 'INVALID_PHONE',
            message: 'Invalid phone number format',
          },
          retryCount: 1,
          willRetry: true,
          nextRetryAt: new Date('2023-01-01T12:10:00Z'),
        },
      };

      const events = [testEvent, event2];
      const loggerDebugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

      // Act
      await service.publishMany(events);

      // Assert
      expect(loggerDebugSpy).toHaveBeenCalledWith('Publishing 2 events in batch');
      expect(loggerDebugSpy).toHaveBeenCalledWith('Successfully published 2 events');
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(2);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('NotificationCreated', testEvent);
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('NotificationFailed', event2);

      loggerDebugSpy.mockRestore();
    });

    it('should handle batch publishing failure', async () => {
      // Arrange
      const events = [testEvent];
      const error = new Error('Batch publish failed');
      mockEventEmitter.emit.mockImplementation(() => {
        throw error;
      });

      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act & Assert
      await expect(service.publishMany(events)).rejects.toThrow('Batch publish failed');
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to publish batch of 1 events', {
        error: 'Batch publish failed',
      });

      loggerErrorSpy.mockRestore();
    });

    it('should handle empty events array', async () => {
      // Arrange
      const loggerDebugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

      // Act
      await service.publishMany([]);

      // Assert
      expect(loggerDebugSpy).toHaveBeenCalledWith('Publishing 0 events in batch');
      expect(loggerDebugSpy).toHaveBeenCalledWith('Successfully published 0 events');

      loggerDebugSpy.mockRestore();
    });
  });

  describe('registerHandler', () => {
    it('should register handler for new event type', () => {
      // Arrange
      const loggerDebugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

      // Act
      service.registerHandler(mockEventHandler);

      // Assert
      expect(loggerDebugSpy).toHaveBeenCalledWith('Registered handler for event: NotificationCreated', {
        handlerName: 'MockEventHandler',
        totalHandlers: 1,
      });

      loggerDebugSpy.mockRestore();
    });

    it('should register multiple handlers for same event type', () => {
      // Arrange
      const loggerDebugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

      // Act
      service.registerHandler(mockEventHandler);
      service.registerHandler(mockEventHandler2);

      // Assert
      expect(loggerDebugSpy).toHaveBeenCalledWith('Registered handler for event: NotificationCreated', {
        handlerName: 'MockEventHandler',
        totalHandlers: 1,
      });
      expect(loggerDebugSpy).toHaveBeenCalledWith('Registered handler for event: NotificationCreated', {
        handlerName: 'MockEventHandler2',
        totalHandlers: 2,
      });

      loggerDebugSpy.mockRestore();
    });

    it('should register handlers for different event types', () => {
      // Arrange
      const differentHandler: EventHandler = {
        eventType: 'NotificationFailed',
        handle: vi.fn(),
        constructor: { name: 'FailedHandler' },
      } as unknown as EventHandler;

      // Act
      service.registerHandler(mockEventHandler);
      service.registerHandler(differentHandler);

      // Assert
      const handlers = (service as any).handlers;
      expect(handlers.get('NotificationCreated')).toHaveLength(1);
      expect(handlers.get('NotificationFailed')).toHaveLength(1);
    });
  });

  describe('createEvent', () => {
    it('should create event with all properties', () => {
      // Arrange
      const eventType = 'NotificationCreated';
      const aggregateId = 'notification-123';
      const aggregateType = 'Notification';
      const payload = {
        notificationId: 'notification-123',
        channel: NotificationChannel.EMAIL,
        recipient: 'test@example.com',
        content: 'Test content',
        priority: NotificationPriority.HIGH,
        metadata: {},
      };
      const options = {
        correlationId: 'correlation-456',
        causationId: 'causation-789',
        userId: 'user-111',
        organizationId: 'org-222',
        source: 'TestSource',
        version: 2,
      };

      // Act
      const event = service.createEvent(
        eventType,
        aggregateId,
        aggregateType,
        payload,
        options
      );

      // Assert
      expect(event).toMatchObject({
        eventType,
        aggregateId,
        aggregateType,
        version: 2,
        correlationId: 'correlation-456',
        causationId: 'causation-789',
        payload,
        metadata: {
          userId: 'user-111',
          organizationId: 'org-222',
          source: 'TestSource',
          correlationId: 'correlation-456',
          causationId: 'causation-789',
          version: 2,
        },
      });
      expect(event.eventId).toMatch(/^[a-f0-9-]{36}$/); // UUID format
      expect(event.occurredAt).toBeInstanceOf(Date);
    });

    it('should create event with default values', () => {
      // Arrange
      const eventType = 'ChannelHealthChanged';
      const aggregateId = 'channel-email';
      const aggregateType = 'Channel';
      const payload = {
        channel: NotificationChannel.EMAIL,
        previousStatus: 'healthy' as const,
        currentStatus: 'degraded' as const,
        changedAt: new Date(),
      };

      // Act
      const event = service.createEvent(eventType, aggregateId, aggregateType, payload);

      // Assert
      expect(event).toMatchObject({
        eventType,
        aggregateId,
        aggregateType,
        version: 1,
        payload,
        metadata: {
          source: 'NotifyHub',
        },
      });
      expect(event.correlationId).toBeUndefined();
      expect(event.causationId).toBeUndefined();
    });

    it('should create event with partial options', () => {
      // Arrange
      const eventType = 'NotificationCreated';
      const payload = { notificationId: 'test' };
      const options = { userId: 'user-123' };

      // Act
      const event = service.createEvent('NotificationCreated', 'agg-123', 'Notification', payload, options);

      // Assert
      expect(event.metadata).toMatchObject({
        userId: 'user-123',
        source: 'NotifyHub',
      });
      expect(event.version).toBe(1);
    });
  });

  describe('isEventHandler', () => {
    it('should return true for valid event handler', () => {
      // Act
      const result = (service as any).isEventHandler(mockEventHandler);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for null object', () => {
      // Act
      const result = (service as any).isEventHandler(null);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for undefined object', () => {
      // Act
      const result = (service as any).isEventHandler(undefined);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for non-object types', () => {
      // Act & Assert
      expect((service as any).isEventHandler('string')).toBe(false);
      expect((service as any).isEventHandler(123)).toBe(false);
      expect((service as any).isEventHandler(true)).toBe(false);
    });

    it('should return false for object without eventType', () => {
      // Arrange
      const invalidHandler = { handle: vi.fn() };

      // Act
      const result = (service as any).isEventHandler(invalidHandler);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for object without handle method', () => {
      // Arrange
      const invalidHandler = { eventType: 'SomeEvent' };

      // Act
      const result = (service as any).isEventHandler(invalidHandler);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for object with wrong eventType type', () => {
      // Arrange
      const invalidHandler = { eventType: 123, handle: vi.fn() };

      // Act
      const result = (service as any).isEventHandler(invalidHandler);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for object with wrong handle type', () => {
      // Arrange
      const invalidHandler = { eventType: 'SomeEvent', handle: 'not a function' };

      // Act
      const result = (service as any).isEventHandler(invalidHandler);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('handleEvent', () => {
    it('should execute handler successfully', async () => {
      // Arrange
      service.registerHandler(mockEventHandler);
      const loggerDebugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

      // Act
      await (service as any).handleEvent(testEvent);

      // Assert
      expect(mockEventHandler.handle).toHaveBeenCalledWith(testEvent);
      expect(loggerDebugSpy).toHaveBeenCalledWith('Executing handler: MockEventHandler', {
        eventType: 'NotificationCreated',
        eventId: 'test-event-123',
      });
      expect(loggerDebugSpy).toHaveBeenCalledWith('Handler executed successfully: MockEventHandler', {
        eventType: 'NotificationCreated',
        eventId: 'test-event-123',
      });

      loggerDebugSpy.mockRestore();
    });

    it('should handle no registered handlers', async () => {
      // Arrange
      const loggerDebugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});

      // Act
      await (service as any).handleEvent(testEvent);

      // Assert
      expect(loggerDebugSpy).toHaveBeenCalledWith('No handlers registered for event: NotificationCreated');

      loggerDebugSpy.mockRestore();
    });

    it('should handle handler execution failure', async () => {
      // Arrange
      const error = new Error('Handler failed');
      mockEventHandler.handle = vi.fn().mockRejectedValue(error);
      service.registerHandler(mockEventHandler);

      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act & Assert
      await expect((service as any).handleEvent(testEvent)).rejects.toThrow('Handler failed');
      expect(loggerErrorSpy).toHaveBeenCalledWith('Handler failed: MockEventHandler', {
        eventType: 'NotificationCreated',
        eventId: 'test-event-123',
        error: 'Handler failed',
      });

      loggerErrorSpy.mockRestore();
    });
  });

  describe('discoverAndRegisterHandlers', () => {
    it('should discover and register handlers from modules', () => {
      // Arrange
      const loggerDebugSpy = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
      const loggerLogSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

      // Act
      (service as any).discoverAndRegisterHandlers();

      // Assert
      expect(loggerDebugSpy).toHaveBeenCalledWith('Starting event handler discovery...');
      expect(mockModuleRef.container.getModules).toHaveBeenCalled();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Event handler discovery completed. Registered 1 handlers.'
      );

      loggerDebugSpy.mockRestore();
      loggerLogSpy.mockRestore();
    });

    it('should handle discovery errors', () => {
      // Arrange
      const error = new Error('Module discovery failed');
      mockModuleRef.container.getModules.mockImplementation(() => {
        throw error;
      });

      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      (service as any).discoverAndRegisterHandlers();

      // Assert
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to discover event handlers', {
        error: 'Module discovery failed',
      });

      loggerErrorSpy.mockRestore();
    });

    it('should handle non-Error exceptions during discovery', () => {
      // Arrange
      mockModuleRef.container.getModules.mockImplementation(() => {
        throw 'String error';
      });

      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      (service as any).discoverAndRegisterHandlers();

      // Assert
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to discover event handlers', {
        error: 'Unknown error',
      });

      loggerErrorSpy.mockRestore();
    });

    it('should skip providers with null instances', () => {
      // Arrange
      const moduleWithNullProvider = {
        providers: new Map([
          ['nullProvider', { instance: null }],
          ['undefinedProvider', { instance: undefined }],
        ]),
      };

      mockModuleRef.container.getModules.mockReturnValue(
        new Map([['testModule', moduleWithNullProvider]])
      );

      const loggerLogSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

      // Act
      (service as any).discoverAndRegisterHandlers();

      // Assert
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Event handler discovery completed. Registered 0 handlers.'
      );

      loggerLogSpy.mockRestore();
    });
  });

  describe('error edge cases', () => {
    it('should handle publish with non-Error exception in publishing', async () => {
      // Arrange
      mockEventEmitter.emit.mockImplementation(() => {
        throw 'String error';
      });

      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act & Assert
      await expect(service.publish(testEvent)).rejects.toBe('String error');
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to publish event: NotificationCreated', {
        eventId: 'test-event-123',
        error: 'Unknown error',
      });

      loggerErrorSpy.mockRestore();
    });

    it('should handle publishMany with non-Error exception', async () => {
      // Arrange
      const events = [testEvent];
      mockEventEmitter.emit.mockImplementation(() => {
        throw 'String error in batch';
      });

      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act & Assert
      await expect(service.publishMany(events)).rejects.toBe('String error in batch');
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to publish batch of 1 events', {
        error: 'Unknown error',
      });

      loggerErrorSpy.mockRestore();
    });
  });

  describe('integration scenarios', () => {
    it('should handle complex event lifecycle', async () => {
      // Arrange
      const handler1 = {
        eventType: 'NotificationCreated',
        handle: vi.fn().mockResolvedValue(undefined),
        constructor: { name: 'Handler1' },
      } as unknown as EventHandler;

      const handler2 = {
        eventType: 'NotificationCreated',
        handle: vi.fn().mockResolvedValue(undefined),
        constructor: { name: 'Handler2' },
      } as unknown as EventHandler;

      // Act - Register handlers
      service.registerHandler(handler1);
      service.registerHandler(handler2);

      // Publish event
      await service.publish(testEvent);

      // Assert
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('NotificationCreated', testEvent);
      expect(handler1.handle).toHaveBeenCalledWith(testEvent);
      expect(handler2.handle).toHaveBeenCalledWith(testEvent);
    });

    it('should handle module initialization and event publishing', () => {
      // Arrange
      const loggerLogSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

      // Act
      service.onModuleInit();

      // Assert - Handler should be auto-discovered and registered
      expect(loggerLogSpy).toHaveBeenCalledWith(
        'Event handler discovery completed. Registered 1 handlers.'
      );

      loggerLogSpy.mockRestore();
    });

    it('should create event and publish it successfully', async () => {
      // Arrange
      service.registerHandler(mockEventHandler);

      const createdEvent = service.createEvent(
        'NotificationCreated',
        'notification-999',
        'Notification',
        {
          notificationId: 'notification-999',
          channel: NotificationChannel.PUSH,
          recipient: 'device-token-123',
          content: 'Push notification content',
          priority: NotificationPriority.HIGH,
          metadata: {},
        },
        {
          correlationId: 'correlation-999',
          userId: 'user-999',
        }
      );

      // Act
      await service.publish(createdEvent);

      // Assert
      expect(mockEventHandler.handle).toHaveBeenCalledWith(createdEvent);
      expect(createdEvent.eventType).toBe('NotificationCreated');
      expect(createdEvent.correlationId).toBe('correlation-999');
    });
  });
});
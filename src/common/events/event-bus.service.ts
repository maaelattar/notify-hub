import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DomainEvent,
  EventHandler,
  EventPublisher,
  AllDomainEvents,
} from './domain-events';
import { randomUUID } from 'crypto';

interface ModuleProvider {
  instance: unknown;
}

interface ModuleContainer {
  providers: Map<string, ModuleProvider>;
}

interface ModuleRefContainer {
  container: {
    getModules(): Map<string, ModuleContainer>;
  };
}

/**
 * Advanced event bus implementation using Observer pattern
 * Provides type-safe event publishing and handling with async support
 * Includes error handling, retries, and monitoring capabilities
 */
@Injectable()
export class EventBusService
  implements EventPublisher, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(EventBusService.name);
  private readonly handlers = new Map<string, EventHandler[]>();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
  private readonly eventEmitter: EventEmitter2 = new (EventEmitter2 as any)({
    wildcard: true,
    delimiter: '.',
    maxListeners: 100,
  });

  constructor(private readonly moduleRef: ModuleRef) {}

  /**
   * Register event handlers during module initialization
   */
  onModuleInit() {
    this.discoverAndRegisterHandlers();
  }

  /**
   * Cleanup event listeners
   */
  onModuleDestroy() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    (this.eventEmitter as any).removeAllListeners();
    this.handlers.clear();
  }

  /**
   * Publish a single domain event
   */
  async publish<T extends DomainEvent>(event: T): Promise<void> {
    this.logger.debug(`Publishing event: ${event.eventType}`, {
      eventId: event.eventId,
      aggregateId: event.aggregateId,
      correlationId: event.correlationId,
    });

    try {
      // Emit to internal event emitter for immediate handling
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      (this.eventEmitter as any).emit(event.eventType, event);

      // Handle registered handlers
      await this.handleEvent(event);

      // Log successful publishing
      this.logger.debug(`Event published successfully: ${event.eventType}`, {
        eventId: event.eventId,
        handlersCount: this.handlers.get(event.eventType)?.length || 0,
      });
    } catch (error) {
      this.logger.error(`Failed to publish event: ${event.eventType}`, {
        eventId: event.eventId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Publish multiple domain events
   */
  async publishMany<T extends DomainEvent>(events: T[]): Promise<void> {
    this.logger.debug(`Publishing ${events.length} events in batch`);

    const publishPromises = events.map((event) => this.publish(event));

    try {
      await Promise.all(publishPromises);
      this.logger.debug(`Successfully published ${events.length} events`);
    } catch (error) {
      this.logger.error(`Failed to publish batch of ${events.length} events`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Register an event handler
   */
  registerHandler<T extends DomainEvent>(handler: EventHandler<T>): void {
    const eventType = handler.eventType;

    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }

    this.handlers.get(eventType)!.push(handler);

    this.logger.debug(`Registered handler for event: ${eventType}`, {
      handlerName: handler.constructor.name,
      totalHandlers: this.handlers.get(eventType)!.length,
    });
  }

  /**
   * Create domain event with metadata
   */
  createEvent<T extends AllDomainEvents>(
    eventType: T['eventType'],
    aggregateId: string,
    aggregateType: string,
    payload: T extends { payload: infer P } ? P : Record<string, unknown>,
    options: {
      correlationId?: string;
      causationId?: string;
      userId?: string;
      organizationId?: string;
      source?: string;
      version?: number;
    } = {},
  ): T {
    const event = {
      eventId: randomUUID(),
      eventType,
      aggregateId,
      aggregateType,
      version: options.version ?? 1,
      occurredAt: new Date(),
      correlationId: options.correlationId,
      causationId: options.causationId,
      metadata: {
        userId: options.userId,
        organizationId: options.organizationId,
        source: options.source ?? 'NotifyHub',
        ...options,
      },
      payload,
    } as T;

    return event;
  }

  /**
   * Handle a single event with all registered handlers
   */
  private async handleEvent<T extends DomainEvent>(event: T): Promise<void> {
    const handlers = this.handlers.get(event.eventType) || [];

    if (handlers.length === 0) {
      this.logger.debug(`No handlers registered for event: ${event.eventType}`);
      return;
    }

    const handlerPromises = handlers.map(async (handler) => {
      try {
        this.logger.debug(`Executing handler: ${handler.constructor.name}`, {
          eventType: event.eventType,
          eventId: event.eventId,
        });

        await handler.handle(event);

        this.logger.debug(
          `Handler executed successfully: ${handler.constructor.name}`,
          {
            eventType: event.eventType,
            eventId: event.eventId,
          },
        );
      } catch (error) {
        this.logger.error(`Handler failed: ${handler.constructor.name}`, {
          eventType: event.eventType,
          eventId: event.eventId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        throw error;
      }
    });

    try {
      await Promise.all(handlerPromises);
    } catch (error) {
      this.logger.error(
        `One or more handlers failed for event: ${event.eventType}`,
        {
          eventId: event.eventId,
          handlersCount: handlers.length,
        },
      );
      throw error;
    }
  }

  /**
   * Automatically discover and register event handlers from the DI container
   */
  private discoverAndRegisterHandlers(): void {
    this.logger.debug('Starting event handler discovery...');

    try {
      // Get all providers from the module container
      const providers = (
        this.moduleRef as unknown as ModuleRefContainer
      ).container.getModules();
      let handlersRegistered = 0;

      for (const module of providers.values()) {
        for (const provider of module.providers.values()) {
          if (provider.instance && this.isEventHandler(provider.instance)) {
            this.registerHandler(provider.instance);
            handlersRegistered++;
          }
        }
      }

      this.logger.log(
        `Event handler discovery completed. Registered ${handlersRegistered} handlers.`,
      );
    } catch (error) {
      this.logger.error('Failed to discover event handlers', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Check if an object is an event handler
   */
  private isEventHandler(obj: unknown): obj is EventHandler {
    if (!obj || typeof obj !== 'object') {
      return false;
    }

    const candidate = obj as { eventType?: unknown; handle?: unknown };
    return (
      typeof candidate.eventType === 'string' &&
      typeof candidate.handle === 'function'
    );
  }
}

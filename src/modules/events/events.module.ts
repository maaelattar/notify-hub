import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

// Core event services
import { EventBusService } from './event-bus.service';

// Event handlers
import {
  NotificationAnalyticsHandler,
  NotificationAuditHandler,
  NotificationCacheHandler,
} from './handlers/notification-event.handlers';

// Dependencies
import { MonitoringModule } from '../monitoring/monitoring.module';

/**
 * EventsModule - Centralized event-driven architecture
 *
 * Features:
 * - Domain event definitions and type safety
 * - Advanced event bus with automatic handler discovery
 * - Event handlers for analytics, auditing, and caching
 * - Integration with monitoring and metrics
 * - Real-time event processing with Observer pattern
 *
 * Services Provided:
 * - EventBusService: Type-safe event publishing and handling
 * - NotificationAnalyticsHandler: Real-time metrics tracking
 * - NotificationAuditHandler: Audit trail maintenance
 * - NotificationCacheHandler: Status caching for performance
 *
 * Architecture:
 * - Observer Pattern: Event handlers automatically discovered and registered
 * - Type Safety: Strong typing for all domain events
 * - Async Processing: Non-blocking event handling
 * - Error Handling: Robust error handling with logging
 * - Monitoring Integration: Events feed into metrics and monitoring
 */
@Module({
  imports: [
    // EventEmitter2 for internal event handling
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 100,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    }),

    // Import MonitoringModule for metrics services
    MonitoringModule,
  ],
  providers: [
    // Core event bus
    EventBusService,

    // Event handlers
    NotificationAnalyticsHandler,
    NotificationAuditHandler,
    NotificationCacheHandler,
  ],
  exports: [
    // Export the main event bus for other modules
    EventBusService,

    // Export handlers in case other modules need direct access
    NotificationAnalyticsHandler,
    NotificationAuditHandler,
    NotificationCacheHandler,
  ],
})
export class EventsModule {}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ErrorGuidanceData {
  message: string;
  documentation?: string;
  examples?: string;
  actions?: string[];
  retryAfter?: string;
  support?: string;
}

/**
 * ErrorGuidance Value Object - Encapsulates user-friendly error guidance
 */
export class ErrorGuidance {
  private constructor(private readonly data: ErrorGuidanceData) {
    this.validate();
  }

  static create(data: ErrorGuidanceData): ErrorGuidance {
    return new ErrorGuidance(data);
  }

  getMessage(): string {
    return this.data.message;
  }

  getDocumentation(): string | undefined {
    return this.data.documentation;
  }

  getActions(): string[] {
    return this.data.actions || [];
  }

  toJSON(): ErrorGuidanceData {
    return { ...this.data };
  }

  private validate(): void {
    if (!this.data.message?.trim()) {
      throw new Error('ErrorGuidance message cannot be empty');
    }
  }
}

/**
 * Strategy interface for error guidance generation
 */
export interface ErrorGuidanceStrategy {
  createGuidance(baseUrl: string): ErrorGuidance;
}

/**
 * Validation Error Strategy
 */
export class ValidationErrorStrategy implements ErrorGuidanceStrategy {
  createGuidance(baseUrl: string): ErrorGuidance {
    return ErrorGuidance.create({
      message:
        'Please check the request format and ensure all required fields are provided correctly.',
      documentation: `${baseUrl}/api#/notifications`,
      examples: `${baseUrl}/api#/notifications/NotificationController_create`,
    });
  }
}

/**
 * Resource Not Found Strategy
 */
export class ResourceNotFoundStrategy implements ErrorGuidanceStrategy {
  createGuidance(baseUrl: string): ErrorGuidance {
    return ErrorGuidance.create({
      message:
        'The requested notification was not found. Please verify the notification ID.',
      actions: [
        'Check if the notification ID is correct',
        'Use GET /api/v1/notifications to list available notifications',
        'Ensure you have permission to access this notification',
      ],
    });
  }
}

/**
 * Rate Limit Strategy
 */
export class RateLimitStrategy implements ErrorGuidanceStrategy {
  createGuidance(baseUrl: string): ErrorGuidance {
    return ErrorGuidance.create({
      message: 'Rate limit exceeded. Please slow down your requests.',
      actions: [
        'Wait for the rate limit to reset (check X-RateLimit-Reset header)',
        'Implement exponential backoff in your client',
        'Contact support if you need higher rate limits',
      ],
      retryAfter: '60 seconds',
    });
  }
}

/**
 * Duplicate Resource Strategy
 */
export class DuplicateResourceStrategy implements ErrorGuidanceStrategy {
  createGuidance(baseUrl: string): ErrorGuidance {
    return ErrorGuidance.create({
      message: 'A notification with this identifier already exists.',
      actions: [
        'Use a different notification ID',
        'Check if this is a duplicate request',
        'Use PUT method to update existing notification',
      ],
    });
  }
}

/**
 * Invalid State Strategy
 */
export class InvalidStateStrategy implements ErrorGuidanceStrategy {
  createGuidance(baseUrl: string): ErrorGuidance {
    return ErrorGuidance.create({
      message:
        "The notification is in a state that doesn't allow this operation.",
      actions: [
        'Check the notification status with GET /api/v1/notifications/{id}',
        'Only pending notifications can be cancelled or updated',
        'Use POST /api/v1/notifications/{id}/retry for failed notifications',
      ],
    });
  }
}

/**
 * Server Error Strategy
 */
export class ServerErrorStrategy implements ErrorGuidanceStrategy {
  createGuidance(baseUrl: string): ErrorGuidance {
    return ErrorGuidance.create({
      message: 'An unexpected error occurred. Our team has been notified.',
      actions: [
        'Please try again in a few moments',
        'If the problem persists, contact support with this correlation ID',
      ],
      support: 'support@notifyhub.com',
    });
  }
}

/**
 * Factory for creating error guidance using Strategy Pattern
 */
@Injectable()
export class ErrorGuidanceFactory {
  private readonly strategies = new Map<string, ErrorGuidanceStrategy>([
    ['VALIDATION_ERROR', new ValidationErrorStrategy()],
    ['RESOURCE_NOT_FOUND', new ResourceNotFoundStrategy()],
    ['NOT_FOUND', new ResourceNotFoundStrategy()], // Alias
    [ERROR_CODES.TOO_MANY_REQUESTS, new RateLimitStrategy()],
    ['DUPLICATE_RESOURCE', new DuplicateResourceStrategy()],
    ['INVALID_STATE', new InvalidStateStrategy()],
  ]);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Create error guidance for given error code and status
   */
  createGuidance(code: string, status: number): ErrorGuidance | null {
    // Try specific error code first
    const strategy = this.strategies.get(code);
    if (strategy) {
      const baseUrl = this.configService.get(
        'API_BASE_URL',
        'http://localhost:3000',
      );
      return strategy.createGuidance(baseUrl);
    }

    // Fallback to status-based guidance
    return this.createStatusBasedGuidance(status);
  }

  /**
   * Register a new error guidance strategy
   */
  registerStrategy(code: string, strategy: ErrorGuidanceStrategy): void {
    this.strategies.set(code, strategy);
  }

  /**
   * Get all registered error codes
   */
  getSupportedCodes(): string[] {
    return Array.from(this.strategies.keys());
  }

  private createStatusBasedGuidance(status: number): ErrorGuidance | null {
    if (status === 500) {
      const baseUrl = this.configService.get(
        'API_BASE_URL',
        'http://localhost:3000',
      );
      return new ServerErrorStrategy().createGuidance(baseUrl);
    }

    // No guidance for other status codes
    return null;
  }
}

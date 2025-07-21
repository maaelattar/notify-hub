import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Request } from 'express';
import { RequestWithCorrelationId } from '../middleware/correlation-id.middleware';
import {
  ValidationErrorContext,
  SecurityErrorContext,
  BusinessErrorContext,
  SystemErrorContext,
} from '../types/notification.types';

interface ErrorContext {
  method: string;
  url: string;
  correlationId: string;
  timestamp: Date;
  userAgent?: string;
  ip?: string;
  userId?: string;
}

/**
 * Standardized error handling interceptor that provides consistent
 * error logging, context enrichment, and error transformation
 */
@Injectable()
export class ErrorHandlingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ErrorHandlingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithCorrelationId>();
    const errorContext = this.createErrorContext(request);

    return next.handle().pipe(
      catchError((error) => {
        // Log the error with context
        this.logError(error, errorContext);

        // Transform and enrich the error
        const transformedError = this.transformError(error, errorContext);

        return throwError(() => transformedError);
      }),
    );
  }

  /**
   * Creates error context from request information
   */
  private createErrorContext(request: RequestWithCorrelationId): ErrorContext {
    return {
      method: request.method,
      url: request.url,
      correlationId: request.correlationId || 'unknown',
      timestamp: new Date(),
      userAgent: request.headers['user-agent'],
      ip: this.extractClientIp(request),
      userId: this.extractUserId(request),
    };
  }

  /**
   * Logs error with appropriate level and structured data
   */
  private logError(error: unknown, context: ErrorContext): void {
    const errorInfo = {
      correlationId: context.correlationId,
      method: context.method,
      url: context.url,
      timestamp: context.timestamp.toISOString(),
      userAgent: context.userAgent,
      ip: context.ip,
      userId: context.userId,
    };

    if (error instanceof HttpException) {
      const status = error.getStatus();

      if (status >= 500) {
        // Server errors - log with full stack trace
        this.logger.error(
          `Server error: ${error.message}`,
          {
            ...errorInfo,
            statusCode: status,
            errorName: error.constructor.name,
            response: error.getResponse(),
          },
          error.stack,
        );
      } else if (status >= 400) {
        // Client errors - log as warning without stack trace
        this.logger.warn(`Client error: ${error.message}`, {
          ...errorInfo,
          statusCode: status,
          errorName: error.constructor.name,
          response: error.getResponse(),
        });
      }
    } else {
      // Unexpected errors - log as error with stack trace
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Unexpected error: ${errorMessage}`,
        {
          ...errorInfo,
          errorName:
            error instanceof Error ? error.constructor.name : 'UnknownError',
          errorType: typeof error,
        },
        errorStack,
      );
    }
  }

  /**
   * Transforms errors into consistent format with additional context
   */
  private transformError(error: unknown, context: ErrorContext): HttpException {
    // If already an HttpException, enrich it with context
    if (error instanceof HttpException) {
      return this.enrichHttpException(error, context);
    }

    // Transform other error types
    if (this.isValidationError(error)) {
      return this.createValidationErrorException(error, context);
    }

    if (this.isSecurityError(error)) {
      return this.createSecurityErrorException(error, context);
    }

    if (this.isBusinessError(error)) {
      return this.createBusinessErrorException(error, context);
    }

    if (this.isDatabaseError(error)) {
      return this.createDatabaseErrorException(error, context);
    }

    if (this.isNetworkError(error)) {
      return this.createNetworkErrorException(error, context);
    }

    // Default: internal server error
    return this.createInternalErrorException(error, context);
  }

  /**
   * Enriches existing HttpException with additional context
   */
  private enrichHttpException(
    error: HttpException,
    context: ErrorContext,
  ): HttpException {
    const originalResponse = error.getResponse();

    if (typeof originalResponse === 'object' && originalResponse !== null) {
      const enrichedResponse = {
        ...originalResponse,
        correlationId: context.correlationId,
        timestamp: context.timestamp.toISOString(),
        path: context.url,
      };

      // Create new exception with enriched response
      const EnhancedException = error.constructor as typeof HttpException;
      return new EnhancedException(enrichedResponse, error.getStatus());
    }

    return error;
  }

  /**
   * Creates validation error exception
   */
  private createValidationErrorException(
    error: unknown,
    context: ErrorContext,
  ): HttpException {
    const errorMessage =
      error instanceof Error ? error.message : 'Validation failed';

    return new HttpException(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: errorMessage,
        code: 'VALIDATION_ERROR',
        correlationId: context.correlationId,
        timestamp: context.timestamp.toISOString(),
        path: context.url,
        context: this.extractValidationContext(error),
      },
      HttpStatus.BAD_REQUEST,
    );
  }

  /**
   * Creates security error exception
   */
  private createSecurityErrorException(
    error: unknown,
    context: ErrorContext,
  ): HttpException {
    const errorMessage =
      error instanceof Error ? error.message : 'Security validation failed';

    return new HttpException(
      {
        statusCode: HttpStatus.UNAUTHORIZED,
        error: 'Unauthorized',
        message: errorMessage,
        code: 'SECURITY_ERROR',
        correlationId: context.correlationId,
        timestamp: context.timestamp.toISOString(),
        path: context.url,
        // Don't expose sensitive security context in response
      },
      HttpStatus.UNAUTHORIZED,
    );
  }

  /**
   * Creates business logic error exception
   */
  private createBusinessErrorException(
    error: unknown,
    context: ErrorContext,
  ): HttpException {
    const errorMessage =
      error instanceof Error ? error.message : 'Business rule violation';

    return new HttpException(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: errorMessage,
        code: 'BUSINESS_ERROR',
        correlationId: context.correlationId,
        timestamp: context.timestamp.toISOString(),
        path: context.url,
        context: this.extractBusinessContext(error),
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /**
   * Creates database error exception
   */
  private createDatabaseErrorException(
    error: unknown,
    context: ErrorContext,
  ): HttpException {
    return new HttpException(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        message: 'Database operation failed',
        code: 'DATABASE_ERROR',
        correlationId: context.correlationId,
        timestamp: context.timestamp.toISOString(),
        path: context.url,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  /**
   * Creates network error exception
   */
  private createNetworkErrorException(
    error: unknown,
    context: ErrorContext,
  ): HttpException {
    return new HttpException(
      {
        statusCode: HttpStatus.BAD_GATEWAY,
        error: 'Bad Gateway',
        message: 'External service communication failed',
        code: 'NETWORK_ERROR',
        correlationId: context.correlationId,
        timestamp: context.timestamp.toISOString(),
        path: context.url,
      },
      HttpStatus.BAD_GATEWAY,
    );
  }

  /**
   * Creates internal server error exception
   */
  private createInternalErrorException(
    error: unknown,
    context: ErrorContext,
  ): HttpException {
    const errorMessage =
      error instanceof Error ? error.message : 'Internal server error';

    return new HttpException(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
        message: errorMessage,
        code: 'INTERNAL_ERROR',
        correlationId: context.correlationId,
        timestamp: context.timestamp.toISOString(),
        path: context.url,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  // Error type detection methods
  private isValidationError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name.includes('Validation') ||
        error.message.includes('validation') ||
        error.message.includes('invalid'))
    );
  }

  private isSecurityError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name.includes('Security') ||
        error.name.includes('Auth') ||
        error.message.includes('unauthorized') ||
        error.message.includes('forbidden'))
    );
  }

  private isBusinessError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name.includes('Business') ||
        error.message.includes('cannot') ||
        error.message.includes('not allowed'))
    );
  }

  private isDatabaseError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name.includes('Query') ||
        error.name.includes('Database') ||
        error.message.includes('duplicate key') ||
        error.message.includes('foreign key'))
    );
  }

  private isNetworkError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.message.includes('ECONNREFUSED') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('EHOSTUNREACH') ||
        error.message.includes('getaddrinfo'))
    );
  }

  // Context extraction methods
  private extractValidationContext(
    error: unknown,
  ): ValidationErrorContext | undefined {
    // Try to extract validation-specific context
    if (error instanceof Error && 'context' in error) {
      return error.context as ValidationErrorContext;
    }
    return undefined;
  }

  private extractBusinessContext(
    error: unknown,
  ): BusinessErrorContext | undefined {
    // Try to extract business-specific context
    if (error instanceof Error && 'context' in error) {
      return error.context as BusinessErrorContext;
    }
    return undefined;
  }

  // Utility methods
  private extractClientIp(request: Request): string {
    const forwardedFor = request.headers['x-forwarded-for'] as string;
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim();
    }

    const realIp = request.headers['x-real-ip'] as string;
    if (realIp) {
      return realIp;
    }

    return request.ip || 'unknown';
  }

  private extractUserId(request: any): string | undefined {
    // Try to extract user ID from various possible locations
    return (
      request.user?.id ||
      request.apiKey?.organizationId ||
      (request.headers['x-user-id'] as string) ||
      undefined
    );
  }
}

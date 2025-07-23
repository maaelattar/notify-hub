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
import { RequestWithCorrelationId } from '../../modules/security/middleware/correlation-id.middleware';
import {
  ValidationErrorContext,
  BusinessErrorContext,
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
        const transformedError = this.errorMapperService.transformError(error, errorContext);

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

    return request.ip ?? 'unknown';
  }

  private extractUserId(request: RequestWithCorrelationId): string | undefined {
    // Try to extract user ID from various possible locations
    return (
      request.user?.id ??
      request.apiKey?.organizationId ??
      (request.headers['x-user-id'] as string) ??
      undefined
    );
  }
}

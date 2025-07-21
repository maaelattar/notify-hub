import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { RequestWithCorrelationId } from '../middleware/correlation-id.middleware';
import { ErrorGuidanceFactory } from '../services/error-guidance.factory';

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(private readonly errorGuidanceFactory: ErrorGuidanceFactory) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithCorrelationId>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';
    let errors: Record<string, string[]> | undefined;

    // Handle different exception types
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const response = exceptionResponse as Record<string, unknown>;
        message = (response.message as string) || exception.message;
        code = (response.code as string) || this.getErrorCode(status);
        errors = response.errors as Record<string, string[]>;
      } else {
        message = exception.message;
        code = this.getErrorCode(status);
      }
    } else if (exception instanceof QueryFailedError) {
      // Handle database errors
      const dbError = this.handleDatabaseError(exception);
      status = dbError.status;
      message = dbError.message;
      code = dbError.code;
    } else if (this.isQueueError(exception)) {
      // Handle Bull queue errors
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Notification queue is temporarily unavailable';
      code = 'QUEUE_ERROR';
    } else if (this.isNetworkError(exception)) {
      // Handle network errors (webhook failures, etc)
      status = HttpStatus.BAD_GATEWAY;
      message = 'External service communication failed';
      code = 'NETWORK_ERROR';
    } else if (exception instanceof Error) {
      // Check for specific error patterns
      if (exception.message.includes('Invalid signature')) {
        status = HttpStatus.UNAUTHORIZED;
        message = 'Invalid webhook signature';
        code = 'INVALID_SIGNATURE';
      } else if (exception.message.includes('Timeout')) {
        status = HttpStatus.GATEWAY_TIMEOUT;
        message = 'Request timeout';
        code = 'TIMEOUT_ERROR';
      } else {
        message = exception.message;
      }
    }

    // Use correlation ID from middleware
    const requestId =
      request.correlationId ||
      (request.headers['x-request-id'] as string) ||
      `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Build error response
    const errorResponse: ErrorResponseDto = {
      statusCode: status,
      error: this.getErrorName(status),
      message,
      code,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Add validation errors if present
    if (errors) {
      errorResponse.errors = errors;
    }

    // Add actionable guidance using factory
    const guidance = this.errorGuidanceFactory.createGuidance(code, status);
    if (guidance) {
      errorResponse.guidance = guidance.toJSON();
    }

    // Add context for debugging (only in development)
    if (process.env.NODE_ENV === 'development') {
      errorResponse.context = {
        method: request.method,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      };
    }

    // Log the error
    this.logError(exception, request, status, requestId);

    // Send response
    response.status(status).json(errorResponse);
  }

  private handleDatabaseError(error: QueryFailedError<any>): {
    status: number;
    message: string;
    code: string;
  } {
    const message = error.message.toLowerCase();

    // Handle common database errors
    if (
      message.includes('duplicate key') ||
      message.includes('unique constraint')
    ) {
      return {
        status: HttpStatus.CONFLICT,
        message: 'Resource already exists',
        code: 'DUPLICATE_RESOURCE',
      };
    }

    if (message.includes('foreign key constraint')) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Related resource not found',
        code: 'INVALID_REFERENCE',
      };
    }

    if (message.includes('not-null constraint')) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Required field missing',
        code: 'MISSING_FIELD',
      };
    }

    // Generic database error
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Database operation failed',
      code: 'DATABASE_ERROR',
    };
  }

  private getErrorCode(status: number): string {
    const errorCodes: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
    };

    return errorCodes[status] || 'UNKNOWN_ERROR';
  }

  private getErrorName(status: number): string {
    const errorNames: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    };

    return errorNames[status] || 'Error';
  }

  private logError(
    exception: unknown,
    request: RequestWithCorrelationId,
    status: number,
    requestId: string,
  ): void {
    const errorLog = {
      correlationId: requestId,
      timestamp: new Date().toISOString(),
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      status,
    };

    if (status >= 500) {
      // Log server errors with stack trace
      this.logger.error(
        `Server error: ${JSON.stringify(errorLog)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else if (status >= 400) {
      // Log client errors without stack trace
      this.logger.warn(`Client error: ${JSON.stringify(errorLog)}`);
    }
  }

  private isQueueError(exception: unknown): boolean {
    if (exception instanceof Error) {
      return (
        exception.message.includes('Queue') ||
        exception.message.includes('Redis') ||
        exception.constructor.name.includes('Queue')
      );
    }
    return false;
  }

  private isNetworkError(exception: unknown): boolean {
    if (exception instanceof Error) {
      return (
        exception.message.includes('ECONNREFUSED') ||
        exception.message.includes('ETIMEDOUT') ||
        exception.message.includes('EHOSTUNREACH') ||
        exception.message.includes('getaddrinfo')
      );
    }
    return false;
  }
}

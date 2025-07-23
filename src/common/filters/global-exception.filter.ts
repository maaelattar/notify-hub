import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { RequestWithCorrelationId } from '../../modules/security/middleware/correlation-id.middleware';
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

    const errorInfo = this.extractErrorInfo(exception);

    // Use correlation ID from middleware
    const requestId =
      request.correlationId ||
      (request.headers['x-request-id'] as string) ||
      `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // Build error response
    const errorResponse: ErrorResponseDto = {
      statusCode: errorInfo.status,
      error: this.getErrorName(errorInfo.status),
      message: errorInfo.message,
      code: errorInfo.code,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Add validation errors if present
    if (errorInfo.errors) {
      errorResponse.errors = errorInfo.errors;
    }

    // Add actionable guidance using factory
    const guidance = this.errorGuidanceFactory.createGuidance(
      errorInfo.code,
      errorInfo.status,
    );
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
    this.logError(exception, request, errorInfo.status, requestId);

    // Send response
    response.status(errorInfo.status).json(errorResponse);
  }

  private extractErrorInfo(exception: unknown): {
    status: number;
    message: string;
    code: string;
    errors?: Record<string, string[]>;
  } {
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
      message = ERROR_MESSAGES.EXTERNAL_SERVICE_COMMUNICATION_FAILED;
      code = ERROR_CODES.NETWORK_ERROR;
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

    return { status, message, code, errors };
  }

  private handleDatabaseError(error: QueryFailedError): {
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
        message: ERROR_MESSAGES.REQUIRED_FIELD_MISSING,
        code: ERROR_CODES.MISSING_FIELD,
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
      [HttpStatus.BAD_REQUEST]: ERROR_CODES.BAD_REQUEST,
      [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHORIZED,
      [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
      [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
      [HttpStatus.CONFLICT]: ERROR_CODES.CONFLICT,
      [HttpStatus.UNPROCESSABLE_ENTITY]: ERROR_CODES.UNPROCESSABLE_ENTITY,
      [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.TOO_MANY_REQUESTS,
      [HttpStatus.INTERNAL_SERVER_ERROR]: ERROR_CODES.INTERNAL_ERROR,
      [HttpStatus.BAD_GATEWAY]: ERROR_CODES.BAD_GATEWAY,
      [HttpStatus.SERVICE_UNAVAILABLE]: ERROR_CODES.SERVICE_UNAVAILABLE,
    };

    return errorCodes[status] || 'UNKNOWN_ERROR';
  }

  private getErrorName(status: number): string {
    const errorNames: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: ERROR_MESSAGES.BAD_REQUEST,
      [HttpStatus.UNAUTHORIZED]: ERROR_MESSAGES.UNAUTHORIZED,
      [HttpStatus.FORBIDDEN]: ERROR_MESSAGES.FORBIDDEN,
      [HttpStatus.NOT_FOUND]: ERROR_MESSAGES.NOT_FOUND,
      [HttpStatus.CONFLICT]: ERROR_MESSAGES.CONFLICT,
      [HttpStatus.UNPROCESSABLE_ENTITY]: ERROR_MESSAGES.UNPROCESSABLE_ENTITY,
      [HttpStatus.TOO_MANY_REQUESTS]: ERROR_MESSAGES.TOO_MANY_REQUESTS,
      [HttpStatus.INTERNAL_SERVER_ERROR]: ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
      [HttpStatus.BAD_GATEWAY]: ERROR_MESSAGES.BAD_GATEWAY,
      [HttpStatus.SERVICE_UNAVAILABLE]: ERROR_MESSAGES.SERVICE_UNAVAILABLE,
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

import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ValidationErrorContext, BusinessErrorContext } from '../types/notification.types';
import { ERROR_MESSAGES, ERROR_CODES } from '../constants/error-codes.constants';

interface ErrorContext {
  method: string;
  url: string;
  correlationId: string;
  timestamp: Date;
  userAgent?: string;
  ip?: string;
  userId?: string;
}

@Injectable()
export class ErrorMapperService {
  /**
   * Transforms errors into consistent format with additional context
   */
  public transformError(error: unknown, context: ErrorContext): HttpException {
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
      error instanceof Error ? error.message : ERROR_MESSAGES.VALIDATION_FAILED;

    return new HttpException(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        error: ERROR_MESSAGES.BAD_REQUEST,
        message: errorMessage,
        code: ERROR_CODES.VALIDATION_ERROR,
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
      error instanceof Error ? error.message : ERROR_MESSAGES.SECURITY_VALIDATION_FAILED;

    return new HttpException(
      {
        statusCode: HttpStatus.UNAUTHORIZED,
        error: ERROR_MESSAGES.UNAUTHORIZED,
        message: errorMessage,
        code: ERROR_CODES.SECURITY_ERROR,
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
      error instanceof Error ? error.message : ERROR_MESSAGES.BUSINESS_RULE_VIOLATION;

    return new HttpException(
      {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: ERROR_MESSAGES.UNPROCESSABLE_ENTITY,
        message: errorMessage,
        code: ERROR_CODES.BUSINESS_ERROR,
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
        error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
        message: ERROR_MESSAGES.DATABASE_OPERATION_FAILED,
        code: ERROR_CODES.DATABASE_ERROR,
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
        error: ERROR_MESSAGES.BAD_GATEWAY,
        message: ERROR_MESSAGES.EXTERNAL_SERVICE_COMMUNICATION_FAILED,
        code: ERROR_CODES.NETWORK_ERROR,
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
      error instanceof Error ? error.message : ERROR_MESSAGES.INTERNAL_SERVER_ERROR;

    return new HttpException(
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
        message: errorMessage,
        code: ERROR_CODES.INTERNAL_ERROR,
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
        error.message.includes(ERROR_MESSAGES.UNAUTHORIZED.toLowerCase()) ||
        error.message.includes(ERROR_MESSAGES.FORBIDDEN.toLowerCase()))
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
}

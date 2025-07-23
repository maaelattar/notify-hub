import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExecutionContext, CallHandler, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { ErrorHandlingInterceptor } from './error-handling.interceptor';
import { RequestWithCorrelationId } from '../../modules/security/middleware/correlation-id.middleware';
import { ValidationErrorContext, BusinessErrorContext } from '../types/notification.types';

describe('ErrorHandlingInterceptor', () => {
  let interceptor: ErrorHandlingInterceptor;
  let mockExecutionContext: {
    switchToHttp: ReturnType<typeof vi.fn>;
  };
  let mockRequest: RequestWithCorrelationId;
  let mockCallHandler: { handle: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock request
    mockRequest = {
      method: 'POST',
      url: '/api/notifications',
      correlationId: 'test-correlation-id',
      headers: {
        'user-agent': 'test-agent/1.0',
        'x-forwarded-for': '192.168.1.100, 10.0.0.1',
        'x-user-id': 'user-123',
      },
      ip: '127.0.0.1',
      user: { id: 'user-456' },
      apiKey: { organizationId: 'org-789' },
    } as unknown as RequestWithCorrelationId;

    // Create mock execution context
    mockExecutionContext = {
      switchToHttp: vi.fn().mockReturnValue({
        getRequest: vi.fn().mockReturnValue(mockRequest),
      }),
    };

    // Create mock call handler
    mockCallHandler = {
      handle: vi.fn(),
    };

    // Create interceptor instance
    interceptor = new ErrorHandlingInterceptor();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('intercept', () => {
    it('should pass through successful requests without modification', async () => {
      // Arrange
      const successResponse = { success: true, data: 'test-data' };
      mockCallHandler.handle.mockReturnValue(of(successResponse));

      // Act
      const result = await interceptor.intercept(
        mockExecutionContext as unknown as ExecutionContext,
        mockCallHandler as unknown as CallHandler,
      ).toPromise();

      // Assert
      expect(result).toEqual(successResponse);
      expect(mockExecutionContext.switchToHttp).toHaveBeenCalled();
    });

    it('should catch and transform errors', async () => {
      // Arrange
      const testError = new Error('Test error');
      mockCallHandler.handle.mockReturnValue(throwError(() => testError));

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(loggerErrorSpy).toHaveBeenCalled();
        loggerErrorSpy.mockRestore();
      }
    });

    it('should handle requests without correlation ID', async () => {
      // Arrange
      const requestWithoutCorrelation = {
        ...mockRequest,
        correlationId: undefined,
      } as RequestWithCorrelationId;

      mockExecutionContext.switchToHttp.mockReturnValue({
        getRequest: vi.fn().mockReturnValue(requestWithoutCorrelation),
      });

      const testError = new Error('Test error');
      mockCallHandler.handle.mockReturnValue(throwError(() => testError));

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        const response = error.getResponse() as any;
        expect(response.correlationId).toBe('unknown');
        loggerErrorSpy.mockRestore();
      }
    });
  });

  describe('createErrorContext', () => {
    it('should create comprehensive error context from request', async () => {
      // Arrange
      const testError = new Error('Test error');
      mockCallHandler.handle.mockReturnValue(throwError(() => testError));

      // Spy on logger to capture context
      let capturedContext: any;
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation((msg, context) => {
        capturedContext = context;
      });

      // Act
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error) {
        // Expected to throw
      }

      // Assert
      expect(capturedContext).toMatchObject({
        method: 'POST',
        url: '/api/notifications',
        userAgent: 'test-agent/1.0',
        ip: '192.168.1.100',
        userId: 'user-456',
      });

      loggerErrorSpy.mockRestore();
    });

    it('should handle missing user information gracefully', async () => {
      // Arrange
      const requestWithoutUser = {
        ...mockRequest,
        user: undefined,
        apiKey: undefined,
        headers: {
          ...mockRequest.headers,
          'x-user-id': undefined,
        },
      } as unknown as RequestWithCorrelationId;

      mockExecutionContext.switchToHttp.mockReturnValue({
        getRequest: vi.fn().mockReturnValue(requestWithoutUser),
      });

      const testError = new Error('Test error');
      mockCallHandler.handle.mockReturnValue(throwError(() => testError));

      let capturedContext: any;
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation((msg, context) => {
        capturedContext = context;
      });

      // Act
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error) {
        // Expected to throw
      }

      // Assert
      expect(capturedContext.userId).toBeUndefined();
      loggerErrorSpy.mockRestore();
    });
  });

  describe('logError', () => {
    it('should log server errors (5xx) with error level and stack trace', async () => {
      // Arrange
      const serverError = new HttpException('Server error', HttpStatus.INTERNAL_SERVER_ERROR);
      mockCallHandler.handle.mockReturnValue(throwError(() => serverError));

      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'Server error: Server error',
          expect.objectContaining({
            statusCode: 500,
            errorName: 'HttpException',
          }),
          expect.any(String), // stack trace
        );
        loggerErrorSpy.mockRestore();
      }
    });

    it('should log client errors (4xx) with warning level without stack trace', async () => {
      // Arrange
      const clientError = new HttpException('Bad request', HttpStatus.BAD_REQUEST);
      mockCallHandler.handle.mockReturnValue(throwError(() => clientError));

      const loggerWarnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(loggerWarnSpy).toHaveBeenCalledWith(
          'Client error: Bad request',
          expect.objectContaining({
            statusCode: 400,
            errorName: 'HttpException',
          }),
        );
        loggerWarnSpy.mockRestore();
      }
    });

    it('should log unexpected errors with error level and stack trace', async () => {
      // Arrange
      const unexpectedError = new Error('Unexpected error');
      mockCallHandler.handle.mockReturnValue(throwError(() => unexpectedError));

      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'Unexpected error: Unexpected error',
          expect.objectContaining({
            errorName: 'Error',
            errorType: 'object',
          }),
          expect.any(String), // stack trace
        );
        loggerErrorSpy.mockRestore();
      }
    });

    it('should handle non-Error objects gracefully', async () => {
      // Arrange
      const stringError = 'String error';
      mockCallHandler.handle.mockReturnValue(throwError(() => stringError));

      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(loggerErrorSpy).toHaveBeenCalledWith(
          'Unexpected error: String error',
          expect.objectContaining({
            errorName: 'UnknownError',
            errorType: 'string',
          }),
          undefined, // no stack trace for non-Error objects
        );
        loggerErrorSpy.mockRestore();
      }
    });
  });

  describe('transformError', () => {
    it('should enrich existing HttpExceptions', async () => {
      // Arrange
      const originalException = new HttpException(
        { message: 'Original error', custom: 'data' },
        HttpStatus.BAD_REQUEST,
      );
      mockCallHandler.handle.mockReturnValue(throwError(() => originalException));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        const response = error.getResponse() as any;
        expect(response.correlationId).toBe('test-correlation-id');
        expect(response.path).toBe('/api/notifications');
        expect(response.custom).toBe('data');
      }
    });

    it('should transform validation errors', async () => {
      // Arrange
      const validationError = new Error('Validation failed for field');
      validationError.name = 'ValidationError';
      mockCallHandler.handle.mockReturnValue(throwError(() => validationError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        const response = error.getResponse() as any;
        expect(response.code).toBe('VALIDATION_ERROR');
        expect(response.message).toBe('Validation failed for field');
      }
    });

    it('should transform security errors', async () => {
      // Arrange
      const securityError = new Error('Unauthorized access');
      securityError.name = 'SecurityError';
      mockCallHandler.handle.mockReturnValue(throwError(() => securityError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        const response = error.getResponse() as any;
        expect(response.code).toBe('SECURITY_ERROR');
      }
    });

    it('should transform business errors', async () => {
      // Arrange
      const businessError = new Error('Business rule violation');
      businessError.name = 'BusinessError';
      mockCallHandler.handle.mockReturnValue(throwError(() => businessError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
        const response = error.getResponse() as any;
        expect(response.code).toBe('BUSINESS_ERROR');
      }
    });

    it('should transform database errors', async () => {
      // Arrange
      const databaseError = new Error('duplicate key violation');
      databaseError.name = 'QueryFailedError';
      mockCallHandler.handle.mockReturnValue(throwError(() => databaseError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        const response = error.getResponse() as any;
        expect(response.code).toBe('DATABASE_ERROR');
      }
    });

    it('should transform network errors', async () => {
      // Arrange
      const networkError = new Error('ECONNREFUSED: Connection refused');
      mockCallHandler.handle.mockReturnValue(throwError(() => networkError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
        const response = error.getResponse() as any;
        expect(response.code).toBe('NETWORK_ERROR');
      }
    });

    it('should handle string response in HttpException enrichment', async () => {
      // Arrange
      const stringResponseException = new HttpException('Simple string message', HttpStatus.BAD_REQUEST);
      mockCallHandler.handle.mockReturnValue(throwError(() => stringResponseException));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error).toBeInstanceOf(HttpException);
        expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(error.getResponse()).toBe('Simple string message');
      }
    });
  });

  describe('error type detection', () => {
    it('should detect validation errors by name', async () => {
      // Arrange
      const error = new Error('Field validation failed');
      error.name = 'ValidationError';
      mockCallHandler.handle.mockReturnValue(throwError(() => error));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (transformedError: any) {
        const response = transformedError.getResponse() as any;
        expect(response.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should detect validation errors by message content', async () => {
      // Arrange
      const error = new Error('Input validation failed');
      mockCallHandler.handle.mockReturnValue(throwError(() => error));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (transformedError: any) {
        const response = transformedError.getResponse() as any;
        expect(response.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should detect security errors by name patterns', async () => {
      // Arrange
      const error = new Error('Access denied');
      error.name = 'AuthenticationError';
      mockCallHandler.handle.mockReturnValue(throwError(() => error));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (transformedError: any) {
        const response = transformedError.getResponse() as any;
        expect(response.code).toBe('SECURITY_ERROR');
      }
    });

    it('should detect business errors by message patterns', async () => {
      // Arrange
      const error = new Error('This operation is not allowed');
      mockCallHandler.handle.mockReturnValue(throwError(() => error));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (transformedError: any) {
        const response = transformedError.getResponse() as any;
        expect(response.code).toBe('BUSINESS_ERROR');
      }
    });

    it('should detect database errors by name and message patterns', async () => {
      // Arrange
      const error = new Error('foreign key constraint violation');
      error.name = 'DatabaseError';
      mockCallHandler.handle.mockReturnValue(throwError(() => error));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (transformedError: any) {
        const response = transformedError.getResponse() as any;
        expect(response.code).toBe('DATABASE_ERROR');
      }
    });

    it('should detect network errors by message patterns', async () => {
      // Arrange
      const error = new Error('ETIMEDOUT: Request timed out');
      mockCallHandler.handle.mockReturnValue(throwError(() => error));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (transformedError: any) {
        const response = transformedError.getResponse() as any;
        expect(response.code).toBe('NETWORK_ERROR');
      }
    });

    it('should handle non-Error objects in error detection', async () => {
      // Arrange
      const stringError = 'String error message';
      mockCallHandler.handle.mockReturnValue(throwError(() => stringError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (transformedError: any) {
        const response = transformedError.getResponse() as any;
        expect(response.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('context extraction', () => {
    it('should extract validation context when available', async () => {
      // Arrange
      const validationError = new Error('Validation failed') as any;
      validationError.name = 'ValidationError';
      validationError.context = {
        field: 'email',
        value: 'invalid-email',
        constraint: 'isEmail',
      } as ValidationErrorContext;
      mockCallHandler.handle.mockReturnValue(throwError(() => validationError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (transformedError: any) {
        const response = transformedError.getResponse() as any;
        expect(response.context).toEqual({
          field: 'email',
          value: 'invalid-email',
          constraint: 'isEmail',
        });
      }
    });

    it('should extract business context when available', async () => {
      // Arrange
      const businessError = new Error('Business rule violation') as any;
      businessError.name = 'BusinessError';
      businessError.context = {
        rule: 'max_notifications_per_day',
        current: 150,
        limit: 100,
      } as BusinessErrorContext;
      mockCallHandler.handle.mockReturnValue(throwError(() => businessError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (transformedError: any) {
        const response = transformedError.getResponse() as any;
        expect(response.context).toEqual({
          rule: 'max_notifications_per_day',
          current: 150,
          limit: 100,
        });
      }
    });

    it('should handle missing context gracefully', async () => {
      // Arrange
      const simpleError = new Error('Simple error');
      simpleError.name = 'ValidationError';
      mockCallHandler.handle.mockReturnValue(throwError(() => simpleError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (transformedError: any) {
        const response = transformedError.getResponse() as any;
        expect(response.context).toBeUndefined();
      }
    });
  });

  describe('utility methods', () => {
    describe('extractClientIp', () => {
      it('should extract IP from x-forwarded-for header', async () => {
        // Arrange
        const requestWithForwardedFor = {
          ...mockRequest,
          headers: {
            ...mockRequest.headers,
            'x-forwarded-for': '203.0.113.1, 198.51.100.2, 192.0.2.3',
          },
        } as RequestWithCorrelationId;

        mockExecutionContext.switchToHttp.mockReturnValue({
          getRequest: vi.fn().mockReturnValue(requestWithForwardedFor),
        });

        const testError = new Error('Test error');
        mockCallHandler.handle.mockReturnValue(throwError(() => testError));

        let capturedContext: any;
        const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation((msg, context) => {
          capturedContext = context;
        });

        // Act
        try {
          await interceptor.intercept(
            mockExecutionContext as unknown as ExecutionContext,
            mockCallHandler as unknown as CallHandler,
          ).toPromise();
          expect.fail('Should have thrown an error');
        } catch (error) {
          // Expected to throw
        }

        // Assert
        expect(capturedContext.ip).toBe('203.0.113.1');
        loggerErrorSpy.mockRestore();
      });

      it('should extract IP from x-real-ip header when x-forwarded-for is not available', async () => {
        // Arrange
        const requestWithRealIp = {
          ...mockRequest,
          headers: {
            ...mockRequest.headers,
            'x-forwarded-for': undefined,
            'x-real-ip': '203.0.113.10',
          },
        } as RequestWithCorrelationId;

        mockExecutionContext.switchToHttp.mockReturnValue({
          getRequest: vi.fn().mockReturnValue(requestWithRealIp),
        });

        const testError = new Error('Test error');
        mockCallHandler.handle.mockReturnValue(throwError(() => testError));

        let capturedContext: any;
        const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation((msg, context) => {
          capturedContext = context;
        });

        // Act
        try {
          await interceptor.intercept(
            mockExecutionContext as unknown as ExecutionContext,
            mockCallHandler as unknown as CallHandler,
          ).toPromise();
          expect.fail('Should have thrown an error');
        } catch (error) {
          // Expected to throw
        }

        // Assert
        expect(capturedContext.ip).toBe('203.0.113.10');
        loggerErrorSpy.mockRestore();
      });

      it('should fall back to request.ip when headers are not available', async () => {
        // Arrange
        const requestWithoutHeaders = {
          ...mockRequest,
          ip: '192.168.1.200',
          headers: {
            ...mockRequest.headers,
            'x-forwarded-for': undefined,
            'x-real-ip': undefined,
          },
        } as RequestWithCorrelationId;

        mockExecutionContext.switchToHttp.mockReturnValue({
          getRequest: vi.fn().mockReturnValue(requestWithoutHeaders),
        });

        const testError = new Error('Test error');
        mockCallHandler.handle.mockReturnValue(throwError(() => testError));

        let capturedContext: any;
        const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation((msg, context) => {
          capturedContext = context;
        });

        // Act
        try {
          await interceptor.intercept(
            mockExecutionContext as unknown as ExecutionContext,
            mockCallHandler as unknown as CallHandler,
          ).toPromise();
          expect.fail('Should have thrown an error');
        } catch (error) {
          // Expected to throw
        }

        // Assert
        expect(capturedContext.ip).toBe('192.168.1.200');
        loggerErrorSpy.mockRestore();
      });

      it('should return "unknown" when no IP is available', async () => {
        // Arrange
        const requestWithoutIp = {
          ...mockRequest,
          ip: undefined,
          headers: {
            ...mockRequest.headers,
            'x-forwarded-for': undefined,
            'x-real-ip': undefined,
          },
        } as RequestWithCorrelationId;

        mockExecutionContext.switchToHttp.mockReturnValue({
          getRequest: vi.fn().mockReturnValue(requestWithoutIp),
        });

        const testError = new Error('Test error');
        mockCallHandler.handle.mockReturnValue(throwError(() => testError));

        let capturedContext: any;
        const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation((msg, context) => {
          capturedContext = context;
        });

        // Act
        try {
          await interceptor.intercept(
            mockExecutionContext as unknown as ExecutionContext,
            mockCallHandler as unknown as CallHandler,
          ).toPromise();
          expect.fail('Should have thrown an error');
        } catch (error) {
          // Expected to throw
        }

        // Assert
        expect(capturedContext.ip).toBe('unknown');
        loggerErrorSpy.mockRestore();
      });
    });

    describe('extractUserId', () => {
      it('should extract user ID from request.user.id', async () => {
        // Already tested in the main test, but let's be explicit
        const testError = new Error('Test error');
        mockCallHandler.handle.mockReturnValue(throwError(() => testError));

        let capturedContext: any;
        const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation((msg, context) => {
          capturedContext = context;
        });

        // Act
        try {
          await interceptor.intercept(
            mockExecutionContext as unknown as ExecutionContext,
            mockCallHandler as unknown as CallHandler,
          ).toPromise();
          expect.fail('Should have thrown an error');
        } catch (error) {
          // Expected to throw
        }

        // Assert
        expect(capturedContext.userId).toBe('user-456');
        loggerErrorSpy.mockRestore();
      });

      it('should fall back to apiKey organization ID when user.id is not available', async () => {
        // Arrange
        const requestWithApiKey = {
          ...mockRequest,
          user: undefined,
          apiKey: { organizationId: 'org-123' },
          headers: {
            ...mockRequest.headers,
            'x-user-id': undefined,
          },
        } as unknown as RequestWithCorrelationId;

        mockExecutionContext.switchToHttp.mockReturnValue({
          getRequest: vi.fn().mockReturnValue(requestWithApiKey),
        });

        const testError = new Error('Test error');
        mockCallHandler.handle.mockReturnValue(throwError(() => testError));

        let capturedContext: any;
        const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation((msg, context) => {
          capturedContext = context;
        });

        // Act
        try {
          await interceptor.intercept(
            mockExecutionContext as unknown as ExecutionContext,
            mockCallHandler as unknown as CallHandler,
          ).toPromise();
          expect.fail('Should have thrown an error');
        } catch (error) {
          // Expected to throw
        }

        // Assert
        expect(capturedContext.userId).toBe('org-123');
        loggerErrorSpy.mockRestore();
      });

      it('should fall back to x-user-id header when other sources are not available', async () => {
        // Arrange
        const requestWithHeader = {
          ...mockRequest,
          user: undefined,
          apiKey: undefined,
          headers: {
            ...mockRequest.headers,
            'x-user-id': 'header-user-789',
          },
        } as unknown as RequestWithCorrelationId;

        mockExecutionContext.switchToHttp.mockReturnValue({
          getRequest: vi.fn().mockReturnValue(requestWithHeader),
        });

        const testError = new Error('Test error');
        mockCallHandler.handle.mockReturnValue(throwError(() => testError));

        let capturedContext: any;
        const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation((msg, context) => {
          capturedContext = context;
        });

        // Act
        try {
          await interceptor.intercept(
            mockExecutionContext as unknown as ExecutionContext,
            mockCallHandler as unknown as CallHandler,
          ).toPromise();
          expect.fail('Should have thrown an error');
        } catch (error) {
          // Expected to throw
        }

        // Assert
        expect(capturedContext.userId).toBe('header-user-789');
        loggerErrorSpy.mockRestore();
      });
    });
  });

  describe('specific error exception creation', () => {
    it('should create validation error exception with proper structure', async () => {
      // Arrange
      const validationError = new Error('Email format is invalid');
      validationError.name = 'ValidationError';
      mockCallHandler.handle.mockReturnValue(throwError(() => validationError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        const response = error.getResponse() as any;
        expect(response).toMatchObject({
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: 'Email format is invalid',
          code: 'VALIDATION_ERROR',
          correlationId: 'test-correlation-id',
          path: '/api/notifications',
        });
        expect(response.timestamp).toBeDefined();
      }
    });

    it('should create security error exception without sensitive context', async () => {
      // Arrange
      const securityError = new Error('Invalid API key');
      securityError.name = 'AuthError';
      mockCallHandler.handle.mockReturnValue(throwError(() => securityError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
        const response = error.getResponse() as any;
        expect(response.code).toBe('SECURITY_ERROR');
        expect(response.context).toBeUndefined(); // Should not expose security context
      }
    });

    it('should create business error exception with context', async () => {
      // Arrange
      const businessError = new Error('Rate limit exceeded') as any;
      businessError.name = 'BusinessError';
      businessError.context = { limit: 100, current: 150 };
      mockCallHandler.handle.mockReturnValue(throwError(() => businessError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
        const response = error.getResponse() as any;
        expect(response.code).toBe('BUSINESS_ERROR');
        expect(response.context).toEqual({ limit: 100, current: 150 });
      }
    });

    it('should create database error exception', async () => {
      // Arrange
      const databaseError = new Error('Connection lost');
      databaseError.name = 'QueryError';
      mockCallHandler.handle.mockReturnValue(throwError(() => databaseError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        const response = error.getResponse() as any;
        expect(response.code).toBe('DATABASE_ERROR');
        expect(response.message).toBe('Database operation failed');
      }
    });

    it('should create network error exception', async () => {
      // Arrange
      const networkError = new Error('EHOSTUNREACH: Host unreachable');
      mockCallHandler.handle.mockReturnValue(throwError(() => networkError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
        const response = error.getResponse() as any;
        expect(response.code).toBe('NETWORK_ERROR');
        expect(response.message).toBe('External service communication failed');
      }
    });

    it('should create internal error exception for unknown errors', async () => {
      // Arrange
      const unknownError = new Error('Something went wrong');
      mockCallHandler.handle.mockReturnValue(throwError(() => unknownError));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        const response = error.getResponse() as any;
        expect(response.code).toBe('INTERNAL_ERROR');
        expect(response.message).toBe('Something went wrong');
      }
    });

    it('should handle non-Error objects in internal error creation', async () => {
      // Arrange
      const nonErrorObject = { unexpected: 'object' };
      mockCallHandler.handle.mockReturnValue(throwError(() => nonErrorObject));

      // Act & Assert
      try {
        await interceptor.intercept(
          mockExecutionContext as unknown as ExecutionContext,
          mockCallHandler as unknown as CallHandler,
        ).toPromise();
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
        const response = error.getResponse() as any;
        expect(response.code).toBe('INTERNAL_ERROR');
        expect(response.message).toBe('Internal server error');
      }
    });
  });
});
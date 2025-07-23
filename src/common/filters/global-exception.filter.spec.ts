import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { GlobalExceptionFilter } from './global-exception.filter';
import { ErrorGuidanceFactory } from '../services/error-guidance.factory';
import { RequestWithCorrelationId } from '../../modules/security/middleware/correlation-id.middleware';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockErrorGuidanceFactory: {
    createGuidance: ReturnType<typeof vi.fn>;
  };
  let mockArgumentsHost: {
    switchToHttp: ReturnType<typeof vi.fn>;
  };
  let mockHttpContext: {
    getResponse: ReturnType<typeof vi.fn>;
    getRequest: ReturnType<typeof vi.fn>;
  };
  let mockResponse: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
  let mockRequest: RequestWithCorrelationId;
  let mockGuidance: {
    toJSON: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock request
    mockRequest = {
      method: 'POST',
      url: '/api/notifications',
      ip: '192.168.1.100',
      correlationId: 'test-correlation-123',
      headers: {
        'user-agent': 'test-client/1.0',
        'x-request-id': 'request-456',
      },
    } as RequestWithCorrelationId;

    // Create mock response
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    // Create mock HTTP context
    mockHttpContext = {
      getResponse: vi.fn().mockReturnValue(mockResponse),
      getRequest: vi.fn().mockReturnValue(mockRequest),
    };

    // Create mock arguments host
    mockArgumentsHost = {
      switchToHttp: vi.fn().mockReturnValue(mockHttpContext),
    };

    // Create mock guidance
    mockGuidance = {
      toJSON: vi.fn().mockReturnValue({
        suggestion: 'Check your input parameters',
        documentation: 'https://docs.example.com/api/errors',
      }),
    };

    // Create mock error guidance factory
    mockErrorGuidanceFactory = {
      createGuidance: vi.fn().mockReturnValue(mockGuidance),
    };

    // Create filter instance
    filter = new GlobalExceptionFilter(mockErrorGuidanceFactory as unknown as ErrorGuidanceFactory);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('catch', () => {
    it('should handle HttpException with object response', () => {
      // Arrange
      const exception = new HttpException(
        {
          message: 'Validation failed',
          errors: { email: ['Must be a valid email'] },
          code: 'VALIDATION_ERROR',
        },
        HttpStatus.BAD_REQUEST,
      );

      // Spy on logger
      const loggerWarnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          requestId: 'test-correlation-123',
          path: '/api/notifications',
          timestamp: expect.any(String),
          errors: { email: ['Must be a valid email'] },
          guidance: {
            suggestion: 'Check your input parameters',
            documentation: 'https://docs.example.com/api/errors',
          },
        }),
      );

      expect(mockErrorGuidanceFactory.createGuidance).toHaveBeenCalledWith('VALIDATION_ERROR', HttpStatus.BAD_REQUEST);
      expect(loggerWarnSpy).toHaveBeenCalled();
      loggerWarnSpy.mockRestore();
    });

    it('should handle HttpException with string response', () => {
      // Arrange
      const exception = new HttpException('Simple error message', HttpStatus.NOT_FOUND);

      // Spy on logger
      const loggerWarnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.NOT_FOUND,
          error: 'Not Found',
          message: 'Simple error message',
          code: 'NOT_FOUND',
          requestId: 'test-correlation-123',
          path: '/api/notifications',
          timestamp: expect.any(String),
        }),
      );

      expect(loggerWarnSpy).toHaveBeenCalled();
      loggerWarnSpy.mockRestore();
    });

    it('should handle QueryFailedError with duplicate key constraint', () => {
      // Arrange
      const error = new QueryFailedError('SELECT * FROM users', [], new Error('duplicate key value violates unique constraint'));

      // Spy on logger - 409 is client error, should use warn
      const loggerWarnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      // Act
      filter.catch(error, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: 'Resource already exists',
          code: 'DUPLICATE_RESOURCE',
          requestId: 'test-correlation-123',
          path: '/api/notifications',
          timestamp: expect.any(String),
        }),
      );

      expect(loggerWarnSpy).toHaveBeenCalled();
      loggerWarnSpy.mockRestore();
    });

    it('should handle QueryFailedError with foreign key constraint', () => {
      // Arrange
      const error = new QueryFailedError('INSERT INTO orders', [], new Error('foreign key constraint violation'));

      // Spy on logger - 400 is client error, should use warn
      const loggerWarnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      // Act
      filter.catch(error, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: 'Related resource not found',
          code: 'INVALID_REFERENCE',
        }),
      );

      expect(loggerWarnSpy).toHaveBeenCalled();
      loggerWarnSpy.mockRestore();
    });

    it('should handle QueryFailedError with not-null constraint', () => {
      // Arrange
      const error = new QueryFailedError('INSERT INTO users', [], new Error('not-null constraint violation'));

      // Spy on logger - 400 is client error, should use warn
      const loggerWarnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      // Act
      filter.catch(error, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Required field missing',
          code: 'MISSING_FIELD',
        }),
      );

      expect(loggerWarnSpy).toHaveBeenCalled();
      loggerWarnSpy.mockRestore();
    });

    it('should handle generic QueryFailedError', () => {
      // Arrange
      const error = new QueryFailedError('generic', [], new Error('Some database error'));

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(error, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Database operation failed',
          code: 'DATABASE_ERROR',
        }),
      );

      expect(loggerErrorSpy).toHaveBeenCalled();
      loggerErrorSpy.mockRestore();
    });

    it('should handle queue errors', () => {
      // Arrange
      const error = new Error('Queue processing failed');

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(error, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Notification queue is temporarily unavailable',
          code: 'QUEUE_ERROR',
        }),
      );

      expect(loggerErrorSpy).toHaveBeenCalled();
      loggerErrorSpy.mockRestore();
    });

    it('should handle Redis errors as queue errors', () => {
      // Arrange
      const error = new Error('Redis connection failed');

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(error, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Notification queue is temporarily unavailable',
          code: 'QUEUE_ERROR',
        }),
      );

      expect(loggerErrorSpy).toHaveBeenCalled();
      loggerErrorSpy.mockRestore();
    });

    it('should handle network errors', () => {
      // Arrange
      const error = new Error('ECONNREFUSED: Connection refused');

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(error, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'External service communication failed',
          code: 'NETWORK_ERROR',
        }),
      );

      expect(loggerErrorSpy).toHaveBeenCalled();
      loggerErrorSpy.mockRestore();
    });

    it('should handle ETIMEDOUT network errors', () => {
      // Arrange
      const error = new Error('ETIMEDOUT: Request timeout');

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(error, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'External service communication failed',
          code: 'NETWORK_ERROR',
        }),
      );

      expect(loggerErrorSpy).toHaveBeenCalled();
      loggerErrorSpy.mockRestore();
    });

    it('should handle EHOSTUNREACH network errors', () => {
      // Arrange
      const error = new Error('EHOSTUNREACH: Host unreachable');

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(error, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'External service communication failed',
          code: 'NETWORK_ERROR',
        }),
      );

      expect(loggerErrorSpy).toHaveBeenCalled();
      loggerErrorSpy.mockRestore();
    });

    it('should handle getaddrinfo network errors', () => {
      // Arrange
      const error = new Error('getaddrinfo ENOTFOUND');

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(error, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'External service communication failed',
          code: 'NETWORK_ERROR',
        }),
      );

      expect(loggerErrorSpy).toHaveBeenCalled();
      loggerErrorSpy.mockRestore();
    });

    it('should handle errors with invalid signature pattern', () => {
      // Arrange
      const error = new Error('Invalid signature provided');

      // Spy on logger
      const loggerWarnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      // Act
      filter.catch(error, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid webhook signature',
          code: 'INVALID_SIGNATURE',
        }),
      );

      expect(loggerWarnSpy).toHaveBeenCalled();
      loggerWarnSpy.mockRestore();
    });

    it('should handle errors with timeout pattern', () => {
      // Arrange
      const error = new Error('Timeout exceeded');

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(error, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.GATEWAY_TIMEOUT);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Request timeout',
          code: 'TIMEOUT_ERROR',
        }),
      );

      expect(loggerErrorSpy).toHaveBeenCalled();
      loggerErrorSpy.mockRestore();
    });

    it('should handle generic Error objects', () => {
      // Arrange
      const error = new Error('Some unexpected error');

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(error, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Some unexpected error',
          code: 'INTERNAL_ERROR',
        }),
      );

      expect(loggerErrorSpy).toHaveBeenCalled();
      loggerErrorSpy.mockRestore();
    });

    it('should handle non-Error exceptions', () => {
      // Arrange
      const stringError = 'Plain string error';

      // Spy on logger
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(stringError, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Internal server error',
          code: 'INTERNAL_ERROR',
        }),
      );

      expect(loggerErrorSpy).toHaveBeenCalled();
      loggerErrorSpy.mockRestore();
    });

    it('should generate request ID when none provided', () => {
      // Arrange
      const requestWithoutCorrelationId = {
        ...mockRequest,
        correlationId: undefined,
        headers: {},
      } as RequestWithCorrelationId;

      mockHttpContext.getRequest.mockReturnValue(requestWithoutCorrelationId);

      const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: expect.stringMatching(/^\d+-[a-z0-9]{9}$/),
        }),
      );
    });

    it('should use x-request-id header when correlation ID not available', () => {
      // Arrange
      const requestWithHeaderId = {
        ...mockRequest,
        correlationId: undefined,
        headers: {
          'x-request-id': 'header-request-789',
        },
      } as RequestWithCorrelationId;

      mockHttpContext.getRequest.mockReturnValue(requestWithHeaderId);

      const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'header-request-789',
        }),
      );
    });

    it('should add development context in development environment', () => {
      // Arrange
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          context: {
            method: 'POST',
            ip: '192.168.1.100',
            userAgent: 'test-client/1.0',
          },
        }),
      );

      // Restore environment
      process.env.NODE_ENV = originalEnv;
    });

    it('should not add development context in production environment', () => {
      // Arrange
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      const callArgs = mockResponse.json.mock.calls[0][0];
      expect(callArgs.context).toBeUndefined();

      // Restore environment
      process.env.NODE_ENV = originalEnv;
    });

    it('should handle null guidance from factory', () => {
      // Arrange
      mockErrorGuidanceFactory.createGuidance.mockReturnValue(null);

      const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      const callArgs = mockResponse.json.mock.calls[0][0];
      expect(callArgs.guidance).toBeUndefined();
    });

    it('should handle undefined guidance from factory', () => {
      // Arrange
      mockErrorGuidanceFactory.createGuidance.mockReturnValue(undefined);

      const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      const callArgs = mockResponse.json.mock.calls[0][0];
      expect(callArgs.guidance).toBeUndefined();
    });
  });

  describe('error code mapping', () => {
    it('should map 400 to BAD_REQUEST code', () => {
      // Arrange
      const exception = new HttpException('Bad request', HttpStatus.BAD_REQUEST);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'BAD_REQUEST',
        }),
      );
    });

    it('should map 401 to UNAUTHORIZED code', () => {
      // Arrange
      const exception = new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'UNAUTHORIZED',
        }),
      );
    });

    it('should map 403 to FORBIDDEN code', () => {
      // Arrange
      const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'FORBIDDEN',
        }),
      );
    });

    it('should map 404 to NOT_FOUND code', () => {
      // Arrange
      const exception = new HttpException('Not found', HttpStatus.NOT_FOUND);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'NOT_FOUND',
        }),
      );
    });

    it('should map 409 to CONFLICT code', () => {
      // Arrange
      const exception = new HttpException('Conflict', HttpStatus.CONFLICT);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CONFLICT',
        }),
      );
    });

    it('should map 422 to UNPROCESSABLE_ENTITY code', () => {
      // Arrange
      const exception = new HttpException('Unprocessable entity', HttpStatus.UNPROCESSABLE_ENTITY);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'UNPROCESSABLE_ENTITY',
        }),
      );
    });

    it('should map 429 to TOO_MANY_REQUESTS code', () => {
      // Arrange
      const exception = new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'TOO_MANY_REQUESTS',
        }),
      );
    });

    it('should map 500 to INTERNAL_ERROR code', () => {
      // Arrange
      const exception = new HttpException('Internal error', HttpStatus.INTERNAL_SERVER_ERROR);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INTERNAL_ERROR',
        }),
      );
    });

    it('should map 502 to BAD_GATEWAY code', () => {
      // Arrange
      const exception = new HttpException('Bad gateway', HttpStatus.BAD_GATEWAY);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'BAD_GATEWAY',
        }),
      );
    });

    it('should map 503 to SERVICE_UNAVAILABLE code', () => {
      // Arrange
      const exception = new HttpException('Service unavailable', HttpStatus.SERVICE_UNAVAILABLE);

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'SERVICE_UNAVAILABLE',
        }),
      );
    });

    it('should map unknown status to UNKNOWN_ERROR code', () => {
      // Arrange
      const exception = new HttpException('Unknown error', 418); // I'm a teapot

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'UNKNOWN_ERROR',
        }),
      );
    });
  });

  describe('error name mapping', () => {
    it('should map status codes to proper error names', () => {
      const testCases = [
        { status: HttpStatus.BAD_REQUEST, expectedName: 'Bad Request' },
        { status: HttpStatus.UNAUTHORIZED, expectedName: 'Unauthorized' },
        { status: HttpStatus.FORBIDDEN, expectedName: 'Forbidden' },
        { status: HttpStatus.NOT_FOUND, expectedName: 'Not Found' },
        { status: HttpStatus.CONFLICT, expectedName: 'Conflict' },
        { status: HttpStatus.UNPROCESSABLE_ENTITY, expectedName: 'Unprocessable Entity' },
        { status: HttpStatus.TOO_MANY_REQUESTS, expectedName: 'Too Many Requests' },
        { status: HttpStatus.INTERNAL_SERVER_ERROR, expectedName: 'Internal Server Error' },
        { status: HttpStatus.BAD_GATEWAY, expectedName: 'Bad Gateway' },
        { status: HttpStatus.SERVICE_UNAVAILABLE, expectedName: ERROR_MESSAGES.SERVICE_UNAVAILABLE },
        { status: 418, expectedName: 'Error' }, // Unknown status
      ];

      testCases.forEach(({ status, expectedName }) => {
        // Arrange
        const exception = new HttpException('Test error', status);

        // Act
        filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

        // Assert
        expect(mockResponse.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expectedName,
          }),
        );

        // Reset mocks for next test
        vi.clearAllMocks();
      });
    });
  });

  describe('logging behavior', () => {
    it('should log server errors (5xx) with error level', () => {
      // Arrange
      const exception = new HttpException('Server error', HttpStatus.INTERNAL_SERVER_ERROR);
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Server error'),
        expect.any(String), // stack trace
      );

      loggerErrorSpy.mockRestore();
    });

    it('should log client errors (4xx) with warn level', () => {
      // Arrange
      const exception = new HttpException('Client error', HttpStatus.BAD_REQUEST);
      const loggerWarnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Client error'),
      );

      loggerWarnSpy.mockRestore();
    });

    it('should include correlation ID in log', () => {
      // Arrange
      const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);
      const loggerWarnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('test-correlation-123'),
      );

      loggerWarnSpy.mockRestore();
    });

    it('should include request details in log', () => {
      // Arrange
      const exception = new HttpException('Test error', HttpStatus.BAD_REQUEST);
      const loggerWarnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      // Act
      filter.catch(exception, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"method":"POST"'),
      );
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"url":"/api/notifications"'),
      );

      loggerWarnSpy.mockRestore();
    });
  });

  describe('queue error detection', () => {
    it('should detect errors with Queue in constructor name', () => {
      // Arrange
      function QueueError(message: string) {
        this.name = 'QueueError';
        this.message = message;
      }
      QueueError.prototype = Error.prototype;

      const error = new (QueueError as any)('Queue job failed');
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(error, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'QUEUE_ERROR',
        }),
      );

      loggerErrorSpy.mockRestore();
    });
  });

  describe('non-Error exception handling', () => {
    it('should handle null exception', () => {
      // Arrange
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(null, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Internal server error',
          code: 'INTERNAL_ERROR',
        }),
      );

      loggerErrorSpy.mockRestore();
    });

    it('should handle undefined exception', () => {
      // Arrange
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(undefined, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Internal server error',
          code: 'INTERNAL_ERROR',
        }),
      );

      loggerErrorSpy.mockRestore();
    });

    it('should handle object exception', () => {
      // Arrange
      const objectError = { type: 'custom', details: 'Something went wrong' };
      const loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

      // Act
      filter.catch(objectError, mockArgumentsHost as unknown as ArgumentsHost);

      // Assert
      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Internal server error',
          code: 'INTERNAL_ERROR',
        }),
      );

      loggerErrorSpy.mockRestore();
    });
  });
});
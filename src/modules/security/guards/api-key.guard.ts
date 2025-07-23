import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import {
  ApiKeyService,
  ApiKeyValidationResult,
} from '../services/api-key.service';
import { ApiKey } from '../entities/api-key.entity';

// Extended Request interface to include API key metadata
export interface AuthenticatedRequest extends Request {
  apiKey?: {
    id: string;
    scopes: string[];
    organizationId?: string;
    rateLimit: {
      limit: number;
      current: number;
      resetTime?: Date;
    };
  };
  requestId?: string;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeyService: ApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if API key authentication is required
    const requireApiKey = this.reflector.getAllAndOverride<boolean>(
      'requireApiKey',
      [context.getHandler(), context.getClass()],
    );

    if (!requireApiKey) {
      return true;
    }

    // Get required scope if specified
    const requiredScope = this.reflector.getAllAndOverride<string>(
      'requireScope',
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Extract request metadata
    const ipAddress = this.getClientIp(request);
    const userAgent = request.headers['user-agent'] ?? 'unknown';
    const endpoint = `${request.method} ${request.route?.path ?? request.url}`;

    try {
      // Extract API key from request
      const apiKey = this.extractApiKey(request);

      if (!apiKey) {
        throw new UnauthorizedException({
          error: 'API key required',
          code: 'MISSING_API_KEY',
          message:
            'Please provide a valid API key in the X-API-Key header or api_key query parameter',
        });
      }

      // Validate API key with comprehensive security checks
      const validationResult: ApiKeyValidationResult =
        await this.apiKeyService.validateApiKey(
          apiKey,
          ipAddress,
          userAgent,
          request.correlationId, // Use correlationId from middleware
          endpoint,
          requiredScope,
        );

      if (!validationResult.valid) {
        this.logger.warn(
          `API key validation failed: ${validationResult.reason}`,
          {
            ipAddress,
            userAgent,
            requestId: request.correlationId,
            endpoint,
            reason: validationResult.reason,
          },
        );

        // Return appropriate error based on reason
        throw this.createUnauthorizedException(validationResult);
      }

      // Attach API key metadata to request for use in controllers
      this.attachApiKeyMetadata(
        request,
        validationResult.apiKey!,
      );

      this.logger.debug(
        `API key validation successful for ${validationResult.apiKey!.name}`,
        {
          apiKeyId: validationResult.apiKey!.id,
          requestId: request.correlationId,
          endpoint,
        },
      );

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.error('Unexpected error during API key validation', {
        error: error instanceof Error ? error.message : error,
        ipAddress,
        userAgent,
        requestId: request.correlationId,
        endpoint,
      });

      throw new UnauthorizedException({
        error: 'Authentication failed',
        code: 'AUTH_ERROR',
        message: 'An error occurred during authentication',
      });
    }
  }

  private extractApiKey(request: Request): string | undefined {
    // Check X-API-Key header first (preferred method)
    const headerKey = request.headers['x-api-key'] as string;
    if (headerKey) {
      return headerKey;
    }

    // Check Authorization header with Bearer scheme
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    return undefined;
  }

  private attachApiKeyMetadata(
    request: AuthenticatedRequest,
    apiKey: ApiKey,
  ): void {
    request.apiKey = {
      id: apiKey.id,
      scopes: apiKey.scopes,
      organizationId: apiKey.organizationId ?? undefined,
      rateLimit: {
        limit: apiKey.rateLimit.limit,
        current: 0, // This will be handled by the ThrottlerGuard
      },
    };
  }

  private createUnauthorizedException(
    validationResult: ApiKeyValidationResult,
  ): UnauthorizedException {
    switch (validationResult.reason) {
      case 'Invalid API key format':
        return new UnauthorizedException({
          error: 'Invalid API key format',
          code: 'INVALID_API_KEY_FORMAT',
          message: 'The provided API key format is invalid',
        });

      case 'Invalid API key':
        return new UnauthorizedException({
          error: 'Invalid API key',
          code: 'INVALID_API_KEY',
          message: 'The provided API key is not valid',
        });

      case 'API key expired':
        return new UnauthorizedException({
          error: 'API key expired',
          code: 'API_KEY_EXPIRED',
          message: 'The provided API key has expired',
        });

      case 'Insufficient permissions':
        return new UnauthorizedException({
          error: 'Insufficient permissions',
          code: 'INSUFFICIENT_PERMISSIONS',
          message:
            'The API key does not have the required permissions for this operation',
        });

      case 'Rate limit exceeded':
        return new UnauthorizedException({
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'API key rate limit exceeded',
          rateLimitInfo: validationResult.rateLimitInfo,
        });

      default:
        return new UnauthorizedException({
          error: 'Authentication failed',
          code: 'AUTH_FAILED',
          message: validationResult.reason ?? 'Authentication failed',
        });
    }
  }
}

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { SecureApiKeyService, ApiKeyValidationResult } from '../services/secure-api-key.service';
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
export class SecureApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(SecureApiKeyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly secureApiKeyService: SecureApiKeyService,
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
    const userAgent = request.headers['user-agent'] || 'unknown';
    const requestId = request.requestId || this.generateRequestId();
    const endpoint = `${request.method} ${request.route?.path || request.url}`;

    // Set request ID for tracking
    request.requestId = requestId;

    try {
      // Extract API key from request
      const apiKey = this.extractApiKey(request);

      if (!apiKey) {
        throw new UnauthorizedException({
          error: 'API key required',
          code: 'MISSING_API_KEY',
          message: 'Please provide a valid API key in the X-API-Key header or api_key query parameter',
        });
      }

      // Validate API key with comprehensive security checks
      const validationResult: ApiKeyValidationResult = await this.secureApiKeyService.validateApiKey(
        apiKey,
        ipAddress,
        userAgent,
        requestId,
        endpoint,
        requiredScope,
      );

      if (!validationResult.valid) {
        this.logger.warn(
          `API key validation failed: ${validationResult.reason}`,
          {
            ipAddress,
            userAgent,
            requestId,
            endpoint,
            reason: validationResult.reason,
          },
        );

        // Return appropriate error based on reason
        throw this.createUnauthorizedException(validationResult);
      }

      // Attach API key metadata to request for use in controllers
      this.attachApiKeyMetadata(request, validationResult.apiKey!, validationResult.rateLimitInfo);

      this.logger.debug(
        `API key validation successful for ${validationResult.apiKey!.name}`,
        {
          apiKeyId: validationResult.apiKey!.id,
          requestId,
          endpoint,
        },
      );

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.error(
        'Unexpected error during API key validation',
        {
          error: error instanceof Error ? error.message : error,
          ipAddress,
          userAgent,
          requestId,
          endpoint,
        },
      );

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
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Check query parameter as fallback (less secure)
    return request.query.api_key as string;
  }

  private getClientIp(request: Request): string {
    // Check various headers for real IP (handle load balancers/proxies)
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

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  private attachApiKeyMetadata(
    request: AuthenticatedRequest,
    apiKey: ApiKey,
    rateLimitInfo?: { limit: number; current: number; resetTime?: Date },
  ): void {
    request.apiKey = {
      id: apiKey.id,
      scopes: apiKey.scopes,
      organizationId: apiKey.organizationId ?? undefined,
      rateLimit: {
        limit: rateLimitInfo?.limit || 0,
        current: rateLimitInfo?.current || 0,
        resetTime: rateLimitInfo?.resetTime,
      },
    };
  }

  private createUnauthorizedException(validationResult: ApiKeyValidationResult): UnauthorizedException {
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
          message: 'The API key does not have the required permissions for this operation',
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
          message: validationResult.reason || 'Authentication failed',
        });
    }
  }
}

// Decorators for easier use
import { SetMetadata } from '@nestjs/common';

export const RequireApiKey = () => SetMetadata('requireApiKey', true);
export const RequireScope = (scope: string) => SetMetadata('requireScope', scope);
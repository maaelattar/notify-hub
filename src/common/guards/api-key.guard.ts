import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requireApiKey = this.reflector.getAllAndOverride<boolean>(
      'requireApiKey',
      [context.getHandler(), context.getClass()],
    );

    if (!requireApiKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = this.extractApiKey(request);

    if (!apiKey) {
      throw new UnauthorizedException('API key required');
    }

    // In production, validate against database
    const isValid = this.validateApiKey(apiKey);

    if (!isValid) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Attach API key metadata to request
    request['apiKey'] = {
      key: apiKey,
      scopes: ['notifications:create', 'notifications:read'],
      rateLimit: { limit: 1000, window: '1h' },
    };

    return true;
  }

  private extractApiKey(request: Request): string | undefined {
    // Check header first
    const headerKey = request.headers['x-api-key'] as string;
    if (headerKey) {
      return headerKey;
    }

    // Check query parameter as fallback
    return request.query.api_key as string;
  }

  private validateApiKey(apiKey: string): boolean {
    // TODO: Implement database lookup
    // This is a placeholder implementation
    const validKeys = process.env.VALID_API_KEYS?.split(',') || [];
    return validKeys.includes(apiKey);
  }
}

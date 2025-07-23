import { ThrottlerGuard } from '@nestjs/throttler';
import { Injectable, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    return req.apiKey ? req.apiKey.id : req.ip;
  }

  protected async getLimit(context: ExecutionContext): Promise<number> {
    const req = context.switchToHttp().getRequest();
    return req.apiKey?.rateLimit?.limit ?? super.getLimit(context);
  }

  protected async getTtl(context: ExecutionContext): Promise<number> {
    const req = context.switchToHttp().getRequest();
    return req.apiKey?.rateLimit?.ttl ?? super.getTtl(context);
  }
}

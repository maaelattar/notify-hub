import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RateLimitHeaderInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<{
          setHeader: (key: string, value: string | number) => void;
        }>();
        const request = context.switchToHttp().getRequest<{
          throttle?: { remaining: number; total: number; reset: number };
        }>();

        // Add rate limit headers
        const throttle = request.throttle;
        const remaining = throttle?.remaining;
        const total = throttle?.total;
        const reset = throttle?.reset;

        if (
          remaining !== undefined &&
          total !== undefined &&
          reset !== undefined
        ) {
          response.setHeader('X-RateLimit-Limit', total.toString());
          response.setHeader('X-RateLimit-Remaining', remaining.toString());
          response.setHeader('X-RateLimit-Reset', reset.toString());
        }
      }),
    );
  }
}

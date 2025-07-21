import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard as BaseThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends BaseThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if rate limiting should be skipped
    const skipRateLimit = this.reflector.getAllAndOverride<boolean>(
      'skipRateLimit',
      [context.getHandler(), context.getClass()],
    );

    if (skipRateLimit) {
      return true;
    }

    // Use default rate limit
    return super.canActivate(context);
  }

  protected getTracker(req: Record<string, any>): Promise<string> {
    // Use IP address for anonymous users
    // Use user ID for authenticated users
    const user = req.user as { id?: string } | undefined;
    if (user?.id) {
      return Promise.resolve(`user-${user.id}`);
    }

    return Promise.resolve(req.ip as string);
  }
}
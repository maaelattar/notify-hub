import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  name: string;
  ttl?: number;
  limit?: number;
}

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

// Convenience decorators
export const SkipRateLimit = () => SetMetadata('skipRateLimit', true);
export const ExpensiveOperation = () => RateLimit({ name: 'expensive' });
export const CreateRateLimit = () => RateLimit({ name: 'create' });

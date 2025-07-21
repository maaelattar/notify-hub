import { SetMetadata } from '@nestjs/common';

/**
 * Decorator to skip rate limiting for a route or controller
 */
export const SkipRateLimit = () => SetMetadata('skipRateLimit', true);

/**
 * Decorator to set custom rate limit for a route or controller
 * @param limit - Number of requests allowed
 * @param ttl - Time window in seconds
 */
export const CustomRateLimit = (limit: number, ttl: number) =>
  SetMetadata('throttle', { limit, ttl });
import { SetMetadata } from '@nestjs/common';

/**
 * Decorator to require API key authentication for a route or controller
 */
export const RequireApiKey = () => SetMetadata('requireApiKey', true);

/**
 * Decorator to require a specific scope for API key authentication
 * @param scope - The required scope (e.g., 'notifications:create')
 */
export const RequireScope = (scope: string) =>
  SetMetadata('requireScope', scope);

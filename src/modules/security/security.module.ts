import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

// Import existing AuthModule (well-organized, no need to break it apart)
import { AuthModule } from '../auth/auth.module';

// Security Guards
import { ApiKeyGuard } from './guards/api-key.guard';
import { CustomThrottlerGuard } from './guards/custom-throttler.guard';

// Security Middleware
import { CorrelationIdMiddleware } from './middleware/correlation-id.middleware';
import { SecurityHeadersMiddleware } from './middleware/security-headers.middleware';

/**
 * SecurityModule - Centralized security, authentication, and authorization
 *
 * Features:
 * - API Key authentication and authorization
 * - Rate limiting and throttling
 * - Security headers and middleware
 * - Correlation ID tracking
 * - Crypto services and security auditing
 * - User authentication and session management
 *
 * Architecture:
 * - Consolidates all security-related functionality
 * - Re-exports AuthModule for authentication services
 * - Provides guards, middleware, and security utilities
 * - Integrates with throttling and rate limiting
 * - Supports API key and user-based authentication
 *
 * Components:
 * - AuthModule: API key management, crypto services, security auditing
 * - Guards: API key validation, custom throttling
 * - Middleware: Security headers, correlation ID tracking
 * - Services: Centralized security configuration
 */
@Module({
  imports: [
    // Import the existing, well-organized AuthModule
    AuthModule,

    // Throttling configuration (could be moved here from AppModule)
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 1 minute
        limit: 100, // 100 requests per minute
      },
      {
        name: 'strict',
        ttl: 60000, // 1 minute
        limit: 20, // 20 requests per minute for sensitive operations
      },
    ]),
  ],
  providers: [
    // Security Guards
    ApiKeyGuard,
    CustomThrottlerGuard,

    // Security Middleware (provided for injection, but configured in main.ts)
    CorrelationIdMiddleware,
    SecurityHeadersMiddleware,
  ],
  exports: [
    // Re-export the entire AuthModule
    AuthModule,

    // Export security guards for use in other modules
    ApiKeyGuard,
    CustomThrottlerGuard,

    // Export middleware for configuration
    CorrelationIdMiddleware,
    SecurityHeadersMiddleware,
  ],
})
export class SecurityModule {}

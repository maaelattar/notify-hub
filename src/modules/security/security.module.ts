import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
// ThrottlerModule is configured in AppModule

// Entities
import { ApiKey } from './entities/api-key.entity';
import { SecurityAuditLog } from './entities/security-audit.entity';

// Services
import { ApiKeyService } from './services/api-key.service';
import { CryptoService } from './services/crypto.service';
import { SecurityAuditService } from './services/security-audit.service';

// Guards
import { ApiKeyGuard } from './guards/api-key.guard';
import { CustomThrottlerGuard } from './guards/throttler.guard';

// Middleware
import { CorrelationIdMiddleware } from './middleware/correlation-id.middleware';
import { SecurityHeadersMiddleware } from './middleware/security-headers.middleware';

// Import SharedModule for RedisProvider
import { SharedModule } from '../shared/shared.module';

/**
 * SecurityModule - Unified security, authentication, and authorization
 *
 * Features:
 * - API Key authentication and authorization with comprehensive validation
 * - Rate limiting and throttling with Redis-backed tracking
 * - Security headers and middleware for protection
 * - Correlation ID tracking for request tracing
 * - Cryptographic services for secure key management
 * - Security auditing and logging
 *
 * Architecture:
 * - Consolidates all security-related functionality into one module
 * - Provides comprehensive API key management with database persistence
 * - Implements enterprise-grade security features
 * - Supports scoped permissions and rate limiting per API key
 * - Includes audit logging for security events
 *
 * Components:
 * - Entities: ApiKey, SecurityAuditLog for data persistence
 * - Services: ApiKeyService, CryptoService, SecurityAuditService
 * - Guards: ApiKeyGuard (advanced), ThrottlerGuard (custom)
 * - Middleware: Security headers, correlation ID tracking
 * - Decorators: RequireApiKey, RequireScope, SkipRateLimit
 */
@Module({
  imports: [
    // Database entities
    TypeOrmModule.forFeature([ApiKey, SecurityAuditLog]),
    
    // Shared module for Redis and other providers
    SharedModule,
    
    // ThrottlerModule is configured in AppModule to avoid duplication
  ],
  providers: [
    // Core Services
    ApiKeyService,
    CryptoService,
    SecurityAuditService,

    // Security Guards
    ApiKeyGuard,
    CustomThrottlerGuard,
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },

    // Security Middleware
    CorrelationIdMiddleware,
    SecurityHeadersMiddleware,
  ],
  exports: [
    // Export services for other modules
    ApiKeyService,
    CryptoService,
    SecurityAuditService,

    // Export guards for use as providers
    ApiKeyGuard,
    CustomThrottlerGuard,

    // Export middleware for manual configuration
    CorrelationIdMiddleware,
    SecurityHeadersMiddleware,

    // Export TypeORM module for entity access
    TypeOrmModule,
  ],
})
export class SecurityModule {}
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ApiKey, ApiKeyRateLimit } from '../entities/api-key.entity';
import { CryptoService } from './crypto.service';
import { SecurityAuditService } from './security-audit.service';
import { RedisProvider } from '../../common/providers/redis.provider';

export interface ApiKeyValidationResult {
  valid: boolean;
  apiKey?: ApiKey;
  reason?: string;
  rateLimitInfo?: {
    limit: number;
    current: number;
    windowMs: number;
    resetTime?: Date;
  };
}

export interface CreateApiKeyRequest {
  name: string;
  scopes: string[];
  rateLimit: ApiKeyRateLimit;
  expiresAt?: Date;
  organizationId?: string;
  createdByUserId?: string;
}

export interface CreateApiKeyResponse {
  apiKey: ApiKey;
  plainTextKey: string; // Only returned once during creation
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepository: Repository<ApiKey>,
    private readonly cryptoService: CryptoService,
    private readonly auditService: SecurityAuditService,
    private readonly redisProvider: RedisProvider,
  ) {}

  /**
   * Create a new API key
   */
  async createApiKey(
    request: CreateApiKeyRequest,
  ): Promise<CreateApiKeyResponse> {
    // Generate secure API key
    const plainTextKey = this.cryptoService.generateApiKey();
    const hashedKey = this.cryptoService.hashApiKey(plainTextKey);

    // Create entity
    const apiKey = new ApiKey();
    apiKey.hashedKey = hashedKey;
    apiKey.name = request.name;
    apiKey.scopes = request.scopes;
    apiKey.rateLimit = request.rateLimit;
    apiKey.expiresAt = request.expiresAt ?? null;
    apiKey.organizationId = request.organizationId ?? null;
    apiKey.createdByUserId = request.createdByUserId ?? null;
    apiKey.isActive = true;

    // Save to database
    const savedApiKey = await this.apiKeyRepository.save(apiKey);

    // Log creation
    await this.auditService.logApiKeyCreated(
      savedApiKey.id,
      savedApiKey.name,
      savedApiKey.scopes,
      request.createdByUserId,
      request.organizationId ?? undefined,
    );

    this.logger.log(`API key created: ${savedApiKey.name} (${savedApiKey.id})`);

    return {
      apiKey: savedApiKey,
      plainTextKey, // Only returned here, never stored
    };
  }

  /**
   * Validate an API key with comprehensive security checks
   */
  async validateApiKey(
    keyString: string,
    ipAddress: string,
    userAgent: string,
    requestId: string,
    endpoint: string,
    requiredScope?: string,
  ): Promise<ApiKeyValidationResult> {
    try {
      // Basic format validation
      if (!this.cryptoService.isValidApiKeyFormat(keyString)) {
        await this.auditService.logInvalidApiKeyAttempt(
          'invalid_format',
          ipAddress,
          userAgent,
          requestId,
          endpoint,
        );

        return {
          valid: false,
          reason: 'Invalid API key format',
        };
      }

      // This is not a constant-time operation, which could theoretically
      // open the door to timing attacks. However, the risk is low and this
      // is a common practice in many systems.
      const apiKeys = await this.apiKeyRepository.find({
        where: { isActive: true },
      });

      let validApiKey: ApiKey | null = null;
      for (const apiKey of apiKeys) {
        if (this.cryptoService.verifyApiKey(keyString, apiKey.hashedKey)) {
          validApiKey = apiKey;
          break;
        }
      }

      if (!validApiKey) {
        await this.auditService.logInvalidApiKeyAttempt(
          this.cryptoService.hashString(keyString), // Don't log the raw key
          ipAddress,
          userAgent,
          requestId,
          endpoint,
        );

        return {
          valid: false,
          reason: 'Invalid API key',
        };
      }

      if (!validApiKey) {
      if (validApiKey.isExpired()) {
        await this.auditService.logExpiredApiKeyAttempt(
          validApiKey.id,
          ipAddress,
          userAgent,
          requestId,
          endpoint,
          validApiKey.organizationId ?? undefined,
        );

        return {
          valid: false,
          reason: 'API key expired',
        };
      }

      // Check scope if required
      if (requiredScope && !validApiKey.hasScope(requiredScope)) {
        await this.auditService.logSecurityEvent({
          eventType: 'SUSPICIOUS_ACTIVITY' as any,
          apiKeyId: validApiKey.id,
          ipAddress,
          userAgent,
          requestId,
          organizationId: validApiKey.organizationId ?? undefined,
          metadata: { endpoint, requiredScope, availableScopes: validApiKey.scopes },
          message: `API key attempted to access ${endpoint} without required scope: ${requiredScope}`,
        });

        return {
          valid: false,
          reason: 'Insufficient permissions',
        };
      }

      // Increment usage counter for this API key
      await this.incrementApiKeyUsage(validApiKey.id, validApiKey.rateLimit);

      // Update last used timestamp
      await this.updateLastUsed(validApiKey.id);

      // Log successful usage
      await this.auditService.logApiKeyUsed(
        validApiKey.id,
        ipAddress,
        userAgent,
        requestId,
        endpoint,
        validApiKey.organizationId ?? undefined,
      );

      return {
        valid: true,
        apiKey: validApiKey,
      };
    } catch (error) {
      this.logger.error('API key validation error:', error);

      return {
        valid: false,
        reason: 'Internal validation error',
      };
    }
  }

  

  /**
   * Increment API key specific usage counter
   */
  private async incrementApiKeyUsage(
    apiKeyId: string,
    rateLimit: ApiKeyRateLimit,
  ): Promise<void> {
    const redis = this.redisProvider.getClient();
    const now = Date.now();

    // Hourly counter
    const hourlyKey = `api_key_usage:${apiKeyId}:${Math.floor(now / (60 * 60 * 1000))}`;
    await redis.incr(hourlyKey);
    await redis.expire(hourlyKey, 3600);

    // Daily counter
    const dailyKey = `api_key_usage:${apiKeyId}:${Math.floor(now / (24 * 60 * 60 * 1000))}`;
    await redis.incr(dailyKey);
    await redis.expire(dailyKey, 86400);
  }

  /**
   * Update last used timestamp
   */
  private async updateLastUsed(apiKeyId: string): Promise<void> {
    await this.apiKeyRepository.update(apiKeyId, {
      lastUsedAt: new Date(),
    });
  }

  /**
   * Deactivate an API key
   */
  async deactivateApiKey(
    apiKeyId: string,
    deactivatedByUserId?: string,
  ): Promise<void> {
    const apiKey = await this.apiKeyRepository.findOne({
      where: { id: apiKeyId },
    });

    if (!apiKey) {
      throw new Error('API key not found');
    }

    await this.apiKeyRepository.update(apiKeyId, { isActive: false });

    await this.auditService.logApiKeyDeleted(
      apiKey.id,
      apiKey.name,
      deactivatedByUserId,
      apiKey.organizationId ?? undefined,
    );

    this.logger.log(`API key deactivated: ${apiKey.name} (${apiKey.id})`);
  }

  /**
   * List API keys for an organization
   */
  async listApiKeys(organizationId?: string): Promise<ApiKey[]> {
    return await this.apiKeyRepository.find({
      where: organizationId ? { organizationId } : {},
      order: { createdAt: 'DESC' },
      select: [
        'id',
        'name',
        'scopes',
        'rateLimit',
        'isActive',
        'lastUsedAt',
        'expiresAt',
        'createdAt',
        'organizationId',
      ], // Exclude hashedKey for security
    });
  }

  /**
   * Clean up expired API keys (can be run periodically)
   */
  async cleanupExpiredKeys(): Promise<number> {
    const expiredKeys = await this.apiKeyRepository.find({
      where: {
        expiresAt: LessThan(new Date()),
        isActive: true,
      },
    });

    if (expiredKeys.length > 0) {
      await this.apiKeyRepository.update(
        { expiresAt: LessThan(new Date()), isActive: true },
        { isActive: false },
      );

      this.logger.log(`Deactivated ${expiredKeys.length} expired API keys`);
    }

    return expiredKeys.length;
  }

  /**
   * Get API key usage statistics
   */
  async getUsageStats(
    apiKeyId: string,
    days: number = 30,
  ): Promise<{
    totalRequests: number;
    dailyBreakdown: Array<{ date: string; requests: number }>;
  }> {
    const redis = this.redisProvider.getClient();
    const now = Date.now();
    const dailyBreakdown: Array<{ date: string; requests: number }> = [];
    let totalRequests = 0;

    for (let i = 0; i < days; i++) {
      const dayTimestamp = Math.floor(
        (now - i * 24 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000),
      );
      const dailyKey = `api_key_usage:${apiKeyId}:${dayTimestamp}`;

      const requests = await redis.get(dailyKey);
      const requestCount = parseInt(requests ?? '0', 10);

      totalRequests += requestCount;
      dailyBreakdown.push({
        date: new Date(dayTimestamp * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0],
        requests: requestCount,
      });
    }

    const sortedBreakdown = [...dailyBreakdown].reverse(); // Oldest first
    return {
      totalRequests,
      dailyBreakdown: sortedBreakdown,
    };
  }
}

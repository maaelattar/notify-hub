import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SecurityAuditLog,
  SecurityEventType,
  SecurityEventMetadata,
} from '../entities/security-audit.entity';

export interface AuditEventData {
  eventType: SecurityEventType;
  apiKeyId?: string;
  hashedKey?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  organizationId?: string;
  metadata?: SecurityEventMetadata;
  message?: string;
}

@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger(SecurityAuditService.name);

  constructor(
    @InjectRepository(SecurityAuditLog)
    private readonly auditRepository: Repository<SecurityAuditLog>,
  ) {}

  /**
   * Log a security event
   */
  async logSecurityEvent(eventData: AuditEventData): Promise<void> {
    try {
      const auditLog = new SecurityAuditLog();
      
      auditLog.eventType = eventData.eventType;
      auditLog.apiKeyId = eventData.apiKeyId || null;
      auditLog.hashedKey = eventData.hashedKey || null;
      auditLog.ipAddress = eventData.ipAddress || null;
      auditLog.userAgent = eventData.userAgent || null;
      auditLog.requestId = eventData.requestId || null;
      auditLog.organizationId = eventData.organizationId || null;
      auditLog.metadata = eventData.metadata || null;
      auditLog.message = eventData.message || null;

      await this.auditRepository.save(auditLog);

      // Log to application logs for immediate monitoring
      this.logger.log(
        `Security Event: ${eventData.eventType} - ${eventData.message}`,
        {
          eventType: eventData.eventType,
          apiKeyId: eventData.apiKeyId,
          ipAddress: eventData.ipAddress,
          requestId: eventData.requestId,
        },
      );
    } catch (error) {
      // Critical: Security audit logging must not fail silently
      this.logger.error(
        'Failed to log security event - this is a critical security issue',
        {
          error: error instanceof Error ? error.message : error,
          eventData,
        },
      );
      
      // In production, this might trigger an alert to security team
      // For now, we'll ensure it's logged at error level for monitoring
    }
  }

  /**
   * Log API key usage
   */
  async logApiKeyUsed(
    apiKeyId: string,
    ipAddress: string,
    userAgent: string,
    requestId: string,
    endpoint: string,
    organizationId?: string,
  ): Promise<void> {
    await this.logSecurityEvent({
      eventType: SecurityEventType.API_KEY_USED,
      apiKeyId,
      ipAddress,
      userAgent,
      requestId,
      organizationId,
      metadata: { endpoint },
      message: `API key used for ${endpoint}`,
    });
  }

  /**
   * Log invalid API key attempt
   */
  async logInvalidApiKeyAttempt(
    hashedKey: string,
    ipAddress: string,
    userAgent: string,
    requestId: string,
    endpoint: string,
  ): Promise<void> {
    await this.logSecurityEvent({
      eventType: SecurityEventType.INVALID_API_KEY_ATTEMPT,
      hashedKey,
      ipAddress,
      userAgent,
      requestId,
      metadata: { endpoint },
      message: `Invalid API key attempt from ${ipAddress} for ${endpoint}`,
    });
  }

  /**
   * Log rate limit exceeded
   */
  async logRateLimitExceeded(
    apiKeyId: string,
    ipAddress: string,
    userAgent: string,
    requestId: string,
    rateLimitInfo: { limit: number; current: number; windowMs: number },
    organizationId?: string,
  ): Promise<void> {
    await this.logSecurityEvent({
      eventType: SecurityEventType.RATE_LIMIT_EXCEEDED,
      apiKeyId,
      ipAddress,
      userAgent,
      requestId,
      organizationId,
      metadata: { rateLimitInfo },
      message: `Rate limit exceeded: ${rateLimitInfo.current}/${rateLimitInfo.limit} requests in ${rateLimitInfo.windowMs}ms window`,
    });
  }

  /**
   * Log API key creation
   */
  async logApiKeyCreated(
    apiKeyId: string,
    name: string,
    scopes: string[],
    createdByUserId?: string,
    organizationId?: string,
  ): Promise<void> {
    await this.logSecurityEvent({
      eventType: SecurityEventType.API_KEY_CREATED,
      apiKeyId,
      organizationId,
      metadata: {
        name,
        scopes,
        createdByUserId,
      },
      message: `API key '${name}' created with scopes: ${scopes.join(', ')}`,
    });
  }

  /**
   * Log API key deletion
   */
  async logApiKeyDeleted(
    apiKeyId: string,
    name: string,
    deletedByUserId?: string,
    organizationId?: string,
  ): Promise<void> {
    await this.logSecurityEvent({
      eventType: SecurityEventType.API_KEY_DELETED,
      apiKeyId,
      organizationId,
      metadata: {
        name,
        deletedByUserId,
      },
      message: `API key '${name}' deleted`,
    });
  }

  /**
   * Log expired API key usage attempt
   */
  async logExpiredApiKeyAttempt(
    apiKeyId: string,
    ipAddress: string,
    userAgent: string,
    requestId: string,
    endpoint: string,
    organizationId?: string,
  ): Promise<void> {
    await this.logSecurityEvent({
      eventType: SecurityEventType.API_KEY_EXPIRED,
      apiKeyId,
      ipAddress,
      userAgent,
      requestId,
      organizationId,
      metadata: { endpoint },
      message: `Expired API key attempt for ${endpoint}`,
    });
  }

  /**
   * Get recent security events for monitoring
   */
  async getRecentEvents(
    limit: number = 100,
    eventTypes?: SecurityEventType[],
  ): Promise<SecurityAuditLog[]> {
    const query = this.auditRepository
      .createQueryBuilder('audit')
      .orderBy('audit.timestamp', 'DESC')
      .limit(limit);

    if (eventTypes && eventTypes.length > 0) {
      query.where('audit.eventType IN (:...eventTypes)', { eventTypes });
    }

    return await query.getMany();
  }

  /**
   * Get security events for a specific API key
   */
  async getApiKeyEvents(
    apiKeyId: string,
    limit: number = 50,
  ): Promise<SecurityAuditLog[]> {
    return await this.auditRepository.find({
      where: { apiKeyId },
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  /**
   * Get suspicious activity (for security monitoring)
   */
  async getSuspiciousActivity(
    timeWindowHours: number = 24,
  ): Promise<{
    invalidAttempts: number;
    rateLimitExceeded: number;
    expiredKeyAttempts: number;
    uniqueIPs: number;
  }> {
    const since = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);

    const [invalidAttempts, rateLimitExceeded, expiredKeyAttempts, ipResults] =
      await Promise.all([
        this.auditRepository.count({
          where: {
            eventType: SecurityEventType.INVALID_API_KEY_ATTEMPT,
            timestamp: { $gte: since } as any,
          },
        }),
        this.auditRepository.count({
          where: {
            eventType: SecurityEventType.RATE_LIMIT_EXCEEDED,
            timestamp: { $gte: since } as any,
          },
        }),
        this.auditRepository.count({
          where: {
            eventType: SecurityEventType.API_KEY_EXPIRED,
            timestamp: { $gte: since } as any,
          },
        }),
        this.auditRepository
          .createQueryBuilder('audit')
          .select('COUNT(DISTINCT audit.ipAddress)', 'count')
          .where('audit.timestamp >= :since', { since })
          .andWhere('audit.eventType IN (:...eventTypes)', {
            eventTypes: [
              SecurityEventType.INVALID_API_KEY_ATTEMPT,
              SecurityEventType.RATE_LIMIT_EXCEEDED,
            ],
          })
          .getRawOne(),
      ]);

    return {
      invalidAttempts,
      rateLimitExceeded,
      expiredKeyAttempts,
      uniqueIPs: parseInt(ipResults?.count || '0', 10),
    };
  }
}
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum SecurityEventType {
  API_KEY_CREATED = 'API_KEY_CREATED',
  API_KEY_DELETED = 'API_KEY_DELETED',
  API_KEY_USED = 'API_KEY_USED',
  INVALID_API_KEY_ATTEMPT = 'INVALID_API_KEY_ATTEMPT',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  API_KEY_EXPIRED = 'API_KEY_EXPIRED',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
}

export interface SecurityEventMetadata {
  apiKeyId?: string;
  hashedKey?: string;
  endpoint?: string;
  userAgent?: string;
  ipAddress?: string;
  requestId?: string;
  organizationId?: string;
  errorMessage?: string;
  rateLimitInfo?: {
    limit: number;
    current: number;
    windowMs: number;
  };
  [key: string]: any;
}

@Entity('security_audit_log')
@Index('idx_security_audit_event_type', ['eventType'])
@Index('idx_security_audit_timestamp', ['timestamp'])
@Index('idx_security_audit_api_key_id', ['apiKeyId'])
export class SecurityAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: SecurityEventType,
  })
  eventType: SecurityEventType;

  @Column({ length: 36, nullable: true })
  apiKeyId: string | null;

  @Column({ length: 64, nullable: true })
  hashedKey: string | null; // For tracking invalid attempts

  @Column({ length: 45, nullable: true }) // IPv6 compatible
  ipAddress: string | null;

  @Column({ length: 500, nullable: true })
  userAgent: string | null;

  @Column({ length: 36, nullable: true })
  requestId: string | null;

  @Column({ length: 36, nullable: true })
  organizationId: string | null;

  @Column('json', { nullable: true })
  metadata: SecurityEventMetadata | null;

  @Column({ length: 1000, nullable: true })
  message: string | null;

  @CreateDateColumn()
  timestamp: Date;

  // Static factory methods for common events
  static createApiKeyUsed(
    apiKeyId: string,
    ipAddress: string,
    userAgent: string,
    requestId: string,
    endpoint: string,
  ): SecurityAuditLog {
    const log = new SecurityAuditLog();
    log.eventType = SecurityEventType.API_KEY_USED;
    log.apiKeyId = apiKeyId;
    log.ipAddress = ipAddress;
    log.userAgent = userAgent;
    log.requestId = requestId;
    log.metadata = { endpoint };
    log.message = `API key used for ${endpoint}`;
    return log;
  }

  static createInvalidAttempt(
    hashedKey: string,
    ipAddress: string,
    userAgent: string,
    requestId: string,
    endpoint: string,
  ): SecurityAuditLog {
    const log = new SecurityAuditLog();
    log.eventType = SecurityEventType.INVALID_API_KEY_ATTEMPT;
    log.hashedKey = hashedKey;
    log.ipAddress = ipAddress;
    log.userAgent = userAgent;
    log.requestId = requestId;
    log.metadata = { endpoint };
    log.message = `Invalid API key attempt from ${ipAddress}`;
    return log;
  }

  static createRateLimitExceeded(
    apiKeyId: string,
    ipAddress: string,
    userAgent: string,
    requestId: string,
    rateLimitInfo: { limit: number; current: number; windowMs: number },
  ): SecurityAuditLog {
    const log = new SecurityAuditLog();
    log.eventType = SecurityEventType.RATE_LIMIT_EXCEEDED;
    log.apiKeyId = apiKeyId;
    log.ipAddress = ipAddress;
    log.userAgent = userAgent;
    log.requestId = requestId;
    log.metadata = { rateLimitInfo };
    log.message = `Rate limit exceeded: ${rateLimitInfo.current}/${rateLimitInfo.limit} requests`;
    return log;
  }
}
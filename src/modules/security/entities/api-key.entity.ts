import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export interface ApiKeyRateLimit {
  hourly: number;
  daily: number;
}

@Entity('api_keys')
@Index('idx_api_keys_hashed_key', ['hashedKey'])
@Index('idx_api_keys_is_active', ['isActive'])
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true, length: 64 })
  hashedKey: string; // SHA-256 hash of the actual key

  @Column({ type: 'varchar', length: 100 })
  name: string; // Human-readable name/description

  @Column('simple-array')
  scopes: string[]; // e.g., ['notifications:create', 'notifications:read']

  @Column('json')
  rateLimit: ApiKeyRateLimit;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'varchar', length: 36, nullable: true })
  organizationId: string | null; // For multi-tenant support

  @Column({ type: 'varchar', length: 36, nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Methods
  isExpired(): boolean {
    return this.expiresAt ? new Date() > this.expiresAt : false;
  }

  hasScope(scope: string): boolean {
    return this.scopes.includes(scope);
  }

  canPerformOperation(operation: string): boolean {
    return this.isActive && !this.isExpired() && this.hasScope(operation);
  }
}

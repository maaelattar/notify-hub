import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationChannel } from '../enums/notification-channel.enum';

@Entity('notifications')
@Index(['status', 'createdAt']) // For filtering by status
@Index(['channel', 'status']) // For channel-specific queries
@Index(['recipient']) // For user history lookup
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: NotificationChannel,
  })
  channel: NotificationChannel;

  @Column({ type: 'varchar', length: 255 })
  recipient: string; // Email, phone number, device token, or webhook URL

  @Column({ type: 'varchar', length: 255, nullable: true })
  subject: string | null; // Required for email, optional for others

  @Column({ type: 'text' })
  content: string; // The main notification content

  @Column({
    type: 'enum',
    enum: NotificationStatus,
    default: NotificationStatus.CREATED,
  })
  status: NotificationStatus;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>; // Channel-specific data

  @Column({ type: 'int', default: 0 })
  retryCount: number;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamp', nullable: true })
  scheduledFor: Date | null; // For scheduled notifications

  @Column({ type: 'timestamp', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Helper methods for business logic
  canRetry(maxRetries: number = 3): boolean {
    return (
      this.status === NotificationStatus.FAILED && this.retryCount < maxRetries
    );
  }

  markAsQueued(): void {
    this.status = NotificationStatus.QUEUED;
  }

  markAsProcessing(): void {
    this.status = NotificationStatus.PROCESSING;
  }

  markAsSent(): void {
    this.status = NotificationStatus.SENT;
    this.sentAt = new Date();
  }

  markAsDelivered(): void {
    this.status = NotificationStatus.DELIVERED;
    this.deliveredAt = new Date();
  }

  markAsFailed(error: string): void {
    this.status = NotificationStatus.FAILED;
    this.lastError = error;
    this.retryCount++;
  }

  markAsCancelled(): void {
    if (
      this.status === NotificationStatus.CREATED ||
      this.status === NotificationStatus.QUEUED
    ) {
      this.status = NotificationStatus.CANCELLED;
    } else {
      throw new Error('Cannot cancel notification in current status');
    }
  }
}

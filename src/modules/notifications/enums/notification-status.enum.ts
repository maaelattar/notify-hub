export enum NotificationStatus {
  CREATED = 'created', // Just created, not yet queued
  QUEUED = 'queued', // Added to processing queue
  PROCESSING = 'processing', // Being processed by worker
  SENT = 'sent', // Successfully sent to channel
  DELIVERED = 'delivered', // Confirmed delivered by channel
  FAILED = 'failed', // Failed after all retries
  CANCELLED = 'cancelled', // Cancelled before sending
}

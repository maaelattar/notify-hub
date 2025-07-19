import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, JobOptions, Job } from 'bull';
import { NotificationPriority } from '../enums/notification-priority.enum';

export interface NotificationJobData {
  notificationId: string;
  priority: NotificationPriority;
  attempt?: number;
  metadata?: Record<string, any>;
}

@Injectable()
export class NotificationProducer {
  private readonly logger = new Logger(NotificationProducer.name);

  constructor(
    @InjectQueue('notifications')
    private readonly notificationQueue: Queue<NotificationJobData>,
  ) {}

  /**
   * Add a single notification to the processing queue
   */
  async addNotificationJob(
    notificationId: string,
    priority: NotificationPriority = NotificationPriority.NORMAL,
    scheduledFor?: Date,
    metadata?: Record<string, any>,
  ): Promise<string> {
    try {
      const jobData: NotificationJobData = {
        notificationId,
        priority,
        metadata,
      };

      const jobOptions = this.buildJobOptions(priority, scheduledFor);

      this.logger.log(
        `Adding notification ${notificationId} to queue with priority ${priority}`,
      );

      const job = await this.notificationQueue.add(
        'process-notification', // Job name
        jobData,
        jobOptions,
      );

      this.logger.log(
        `Job ${job.id} created for notification ${notificationId}`,
      );
      return job.id as string;
    } catch (error) {
      this.logger.error(
        `Failed to add notification ${notificationId} to queue`,
        error instanceof Error ? error.stack : error,
      );
      throw new Error(
        `Failed to queue notification: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Add multiple notifications to queue (batch operation)
   */
  async addBulkNotificationJobs(
    notifications: Array<{
      id: string;
      priority?: NotificationPriority;
      scheduledFor?: Date;
      metadata?: Record<string, any>;
    }>,
  ): Promise<string[]> {
    this.logger.log(`Adding ${notifications.length} notifications to queue`);

    try {
      const jobs = await Promise.all(
        notifications.map((notification) =>
          this.addNotificationJob(
            notification.id,
            notification.priority || NotificationPriority.NORMAL,
            notification.scheduledFor,
            notification.metadata,
          ),
        ),
      );

      this.logger.log(`Successfully queued ${jobs.length} notifications`);
      return jobs;
    } catch (error) {
      this.logger.error(
        'Failed to add bulk notifications to queue',
        error instanceof Error ? error.stack : error,
      );
      throw new Error(
        `Failed to queue bulk notifications: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Remove a notification from queue (if not yet processed)
   */
  async removeNotificationJob(notificationId: string): Promise<boolean> {
    try {
      // Try to get the job by ID first (if using notification ID as job ID)
      const job = await this.notificationQueue.getJob(notificationId);
      if (job) {
        await job.remove();
        this.logger.log(`Removed job for notification ${notificationId}`);
        return true;
      }

      // Fallback: search through pending jobs
      const jobs = await this.notificationQueue.getJobs([
        'waiting',
        'delayed',
        'paused',
      ]);

      const foundJob = jobs.find(
        (j) => j.data.notificationId === notificationId,
      );

      if (foundJob) {
        await foundJob.remove();
        this.logger.log(`Removed job for notification ${notificationId}`);
        return true;
      }

      this.logger.warn(
        `No pending job found for notification ${notificationId}`,
      );
      return false;
    } catch (error) {
      this.logger.error(
        `Failed to remove notification ${notificationId} from queue`,
        error instanceof Error ? error.stack : error,
      );
      throw new Error(
        `Failed to remove notification from queue: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    try {
      const [jobCounts, isPaused, workers] = await Promise.all([
        this.notificationQueue.getJobCounts(),
        this.notificationQueue.isPaused(),
        this.notificationQueue.getWorkers(),
      ]);
      const workersCount = workers.length;

      return {
        name: this.notificationQueue.name,
        counts: jobCounts,
        isPaused,
        workersCount,
      };
    } catch (error) {
      this.logger.error(
        'Failed to get queue stats',
        error instanceof Error ? error.stack : error,
      );
      throw new Error(
        `Failed to get queue statistics: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Pause/resume queue processing
   */
  async pauseQueue(): Promise<void> {
    try {
      await this.notificationQueue.pause();
      this.logger.warn('Notification queue paused');
    } catch (error) {
      this.logger.error(
        'Failed to pause queue',
        error instanceof Error ? error.stack : error,
      );
      throw new Error(
        `Failed to pause queue: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async resumeQueue(): Promise<void> {
    try {
      await this.notificationQueue.resume();
      this.logger.log('Notification queue resumed');
    } catch (error) {
      this.logger.error(
        'Failed to resume queue',
        error instanceof Error ? error.stack : error,
      );
      throw new Error(
        `Failed to resume queue: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get a specific job by ID
   */
  async getJob(jobId: string): Promise<Job<NotificationJobData> | null> {
    try {
      return await this.notificationQueue.getJob(jobId);
    } catch (error) {
      this.logger.error(
        `Failed to get job ${jobId}`,
        error instanceof Error ? error.stack : error,
      );
      return null;
    }
  }

  /**
   * Build job options based on priority and schedule
   */
  private buildJobOptions(
    priority: NotificationPriority,
    scheduledFor?: Date,
  ): JobOptions {
    const baseOptions: JobOptions = {
      removeOnComplete: {
        age: 3600, // Keep completed jobs for 1 hour
        count: 100, // Keep last 100 completed jobs
      },
      removeOnFail: false, // Keep failed jobs for debugging
      attempts: this.getRetryAttempts(priority),
      backoff: {
        type: 'exponential',
        delay: this.getBackoffDelay(priority),
      },
      timeout: 30000, // 30 seconds timeout
    };

    // Add priority-specific options
    switch (priority) {
      case NotificationPriority.HIGH:
        baseOptions.priority = 1; // Lower number = higher priority
        baseOptions.lifo = true; // Last in, first out for high priority
        break;
      case NotificationPriority.LOW:
        baseOptions.priority = 10;
        break;
      default:
        baseOptions.priority = 5;
    }

    // Add delay for scheduled notifications
    if (scheduledFor) {
      const delay = scheduledFor.getTime() - Date.now();
      if (delay > 0) {
        baseOptions.delay = delay;
        this.logger.debug(`Job will be delayed by ${delay}ms`);
      }
    }

    return baseOptions;
  }

  private getRetryAttempts(priority: NotificationPriority): number {
    switch (priority) {
      case NotificationPriority.HIGH:
        return 5; // More retries for high priority
      case NotificationPriority.LOW:
        return 2; // Fewer retries for low priority
      default:
        return 3;
    }
  }

  private getBackoffDelay(priority: NotificationPriority): number {
    switch (priority) {
      case NotificationPriority.HIGH:
        return 1000; // 1 second initial delay
      case NotificationPriority.LOW:
        return 5000; // 5 seconds initial delay
      default:
        return 2000; // 2 seconds initial delay
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

export interface QueueHealthStatus {
  name: string;
  isReady: boolean;
  isPaused: boolean;
  workersCount: number;
  jobCounts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  };
  isHealthy: boolean;
  issues?: string[];
}

@Injectable()
export class QueueHealthIndicator {
  private readonly logger = new Logger(QueueHealthIndicator.name);

  constructor(
    @InjectQueue('notifications') private readonly notificationQueue: Queue,
  ) {}

  async getQueueHealth(): Promise<QueueHealthStatus> {
    try {
      // Check if queue is ready by attempting to get job counts
      let queueIsReady = true;
      try {
        await this.notificationQueue.getJobCounts();
      } catch {
        queueIsReady = false;
      }

      const queueIsPaused: boolean = await this.notificationQueue.isPaused();
      const workers = await this.notificationQueue.getWorkers();
      const workersCount = workers.length;
      const jobCounts = await this.notificationQueue.getJobCounts();

      const issues: string[] = [];

      // Health checks
      if (!queueIsReady) {
        issues.push('Queue is not ready');
      }

      if (queueIsPaused) {
        issues.push('Queue is paused');
      }

      if (workersCount === 0) {
        issues.push('No workers processing jobs');
      }

      if (jobCounts.failed > 100) {
        issues.push(`High number of failed jobs: ${jobCounts.failed}`);
      }

      if (jobCounts.waiting > 1000) {
        issues.push(`High number of waiting jobs: ${jobCounts.waiting}`);
      }

      const isHealthy = issues.length === 0;

      const status: QueueHealthStatus = {
        name: this.notificationQueue.name,
        isReady: queueIsReady,
        isPaused: queueIsPaused,
        workersCount,
        jobCounts: {
          waiting: jobCounts.waiting,
          active: jobCounts.active,
          completed: jobCounts.completed,
          failed: jobCounts.failed,
          delayed: jobCounts.delayed,
          paused: 0, // Bull doesn't provide this, set to 0
        },
        isHealthy,
        issues: issues.length > 0 ? issues : undefined,
      };

      if (!isHealthy) {
        this.logger.warn('Queue health check failed', { status });
      } else {
        this.logger.debug('Queue health check passed', { status });
      }

      return status;
    } catch (error) {
      this.logger.error(
        'Failed to check queue health',
        error instanceof Error ? error.stack : error,
      );

      return {
        name: this.notificationQueue.name,
        isReady: false,
        isPaused: false,
        workersCount: 0,
        jobCounts: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: 0,
        },
        isHealthy: false,
        issues: [
          `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        ],
      };
    }
  }

  async pauseQueue(): Promise<void> {
    try {
      await this.notificationQueue.pause();
      this.logger.warn('Queue paused manually');
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
      this.logger.log('Queue resumed manually');
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

  async cleanQueue(
    gracePeriod: number = 3600000,
  ): Promise<{ removed: number }> {
    try {
      // Clean completed jobs older than grace period (default 1 hour)
      const cleaned = await this.notificationQueue.clean(
        gracePeriod,
        'completed',
        100,
      );

      this.logger.log(`Cleaned ${cleaned.length} completed jobs from queue`);

      return { removed: cleaned.length };
    } catch (error) {
      this.logger.error(
        'Failed to clean queue',
        error instanceof Error ? error.stack : error,
      );
      throw new Error(
        `Failed to clean queue: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}

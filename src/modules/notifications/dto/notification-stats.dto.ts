import { ApiProperty } from '@nestjs/swagger';

export class NotificationStatsDto {
  @ApiProperty({
    example: { created: 10, queued: 5, sent: 85, failed: 5 },
    description: 'Count of notifications by status',
  })
  statusCounts: Record<string, number>;

  @ApiProperty({
    example: { email: 90, sms: 10 },
    description: 'Count of notifications by channel',
  })
  channelCounts: Record<string, number>;

  @ApiProperty({
    example: 100,
    description: 'Total number of notifications',
  })
  totalNotifications: number;

  @ApiProperty({
    example: 85,
    description: 'Success rate percentage',
  })
  successRate: number;

  @ApiProperty({
    example: 5,
    description: 'Number of recent failures',
  })
  recentFailureCount: number;

  @ApiProperty({
    example: [
      {
        id: '123e4567-e89b-12d3-a456-426614174000',
        channel: 'email',
        error: 'SMTP connection failed',
        failedAt: '2024-01-01T12:00:00Z',
      },
    ],
    description: 'Recent failure details',
  })
  recentFailures: Array<{
    id: string;
    channel: string;
    error: string | null;
    failedAt: Date;
  }>;

  @ApiProperty({
    example: [],
    description: 'Pending notifications for processing',
    isArray: true,
  })
  pendingNotifications: any[];
}

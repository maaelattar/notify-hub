import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
  ParseUUIDPipe,
  ValidationPipe,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiExtraModels,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { NotificationService } from '../services/notification.service';
import { CreateNotificationDto } from '../dto/create-notification.dto';
import { UpdateNotificationDto } from '../dto/update-notification.dto';
import { NotificationResponseDto } from '../dto/notification-response.dto';
import { NotificationFilterDto } from '../dto/notification-filter.dto';
import { PaginatedResponseDto } from '../dto/paginated-response.dto';
import { NotificationStatsDto } from '../dto/notification-stats.dto';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { ApiPaginatedResponse } from '../decorators/api-paginated-response.decorator';
import {
  CreateRateLimit,
  SkipRateLimit,
  ExpensiveOperation,
} from '../../../common/decorators/rate-limit.decorator';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(ThrottlerGuard)
@UseInterceptors(ClassSerializerInterceptor)
@ApiExtraModels(PaginatedResponseDto, NotificationResponseDto)
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Create a new notification
   */
  @Post()
  @CreateRateLimit() // 10 per minute
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new notification',
    description:
      'Creates a notification and queues it for delivery. Supports idempotency via Idempotency-Key header.',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Notification created successfully',
    type: NotificationResponseDto,
    headers: {
      'X-Request-ID': {
        description: 'Unique request identifier',
        schema: { type: 'string' },
      },
      'X-Idempotent-Replayed': {
        description: 'Whether this is a replayed response',
        schema: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded',
    headers: {
      'X-RateLimit-Limit': {
        description: 'Request limit per window',
        schema: { type: 'number' },
      },
      'X-RateLimit-Remaining': {
        description: 'Remaining requests in window',
        schema: { type: 'number' },
      },
      'X-RateLimit-Reset': {
        description: 'Window reset time (Unix timestamp)',
        schema: { type: 'number' },
      },
    },
  })
  async create(
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    createNotificationDto: CreateNotificationDto,
  ): Promise<NotificationResponseDto> {
    this.logger.log(
      `Creating notification for ${createNotificationDto.recipient}`,
    );

    try {
      const notification = await this.notificationService.create(
        createNotificationDto,
      );
      return notification;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Failed to create notification: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Get all notifications with filtering and pagination
   */
  @Get()
  @ApiOperation({
    summary: 'List notifications',
    description:
      'Get a paginated list of notifications with optional filtering',
  })
  @ApiPaginatedResponse(NotificationResponseDto)
  @ApiQuery({
    name: 'pagination',
    required: false,
    description: 'Pagination object with page and limit',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [
      'created',
      'queued',
      'processing',
      'sent',
      'delivered',
      'failed',
      'cancelled',
    ],
  })
  @ApiQuery({
    name: 'channel',
    required: false,
    enum: ['email', 'sms', 'push', 'webhook'],
  })
  @ApiQuery({ name: 'recipient', required: false, type: String })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['createdAt', 'updatedAt', 'status'],
    example: 'createdAt',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ['ASC', 'DESC'],
    example: 'DESC',
  })
  async findAll(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    filterDto: NotificationFilterDto,
  ): Promise<PaginatedResponseDto<NotificationResponseDto>> {
    this.logger.debug(
      `Fetching notifications with filters: ${JSON.stringify(filterDto)}`,
    );

    return await this.notificationService.findAll(filterDto);
  }

  /**
   * Get a single notification by ID
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get notification by ID',
    description: 'Retrieve a single notification with all details',
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Notification ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification found',
    type: NotificationResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Notification not found',
  })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<NotificationResponseDto> {
    this.logger.debug(`Fetching notification ${id}`);

    const notification = await this.notificationService.findOne(id);
    return notification;
  }

  /**
   * Update a notification (limited fields)
   */
  @Patch(':id')
  @ApiOperation({
    summary: 'Update notification',
    description:
      'Update notification details (only allowed for pending notifications)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification updated successfully',
    type: NotificationResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Cannot update sent notifications',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Notification not found',
  })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    updateNotificationDto: UpdateNotificationDto,
  ): Promise<NotificationResponseDto> {
    this.logger.log(`Updating notification ${id}`);

    const notification = await this.notificationService.update(
      id,
      updateNotificationDto,
    );
    return notification;
  }

  /**
   * Cancel a notification
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel notification',
    description: 'Cancel a pending or queued notification',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification cancelled successfully',
    type: NotificationResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Cannot cancel notification in current state',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Notification not found',
  })
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<NotificationResponseDto> {
    this.logger.log(`Cancelling notification ${id}`);

    const notification = await this.notificationService.cancel(id);
    return notification;
  }

  /**
   * Retry a failed notification
   */
  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry failed notification',
    description: 'Retry a failed notification (resets retry count)',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification queued for retry',
    type: NotificationResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Notification cannot be retried',
  })
  async retry(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<NotificationResponseDto> {
    this.logger.log(`Retrying notification ${id}`);

    const notification = await this.notificationService.retry(id);
    return notification;
  }

  /**
   * Get notification statistics
   */
  @Get('stats/overview')
  @ExpensiveOperation() // 5 per 5 minutes
  @ApiOperation({
    summary: 'Get notification statistics',
    description: 'Get overview statistics for notifications',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    format: 'date-time',
  })
  @ApiQuery({ name: 'to', required: false, type: String, format: 'date-time' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Statistics retrieved successfully',
    type: NotificationStatsDto,
  })
  async getStats(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Query('from') from?: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Query('to') to?: string,
  ): Promise<NotificationStatsDto> {
    this.logger.debug('Fetching notification statistics');

    const stats = await this.notificationService.getStats();

    return {
      statusCounts: stats.statusCounts,
      channelCounts: {},
      totalNotifications:
        stats.statusCounts.created +
        stats.statusCounts.sent +
        stats.statusCounts.failed,
      successRate:
        ((stats.statusCounts.sent || 0) /
          Math.max(1, stats.statusCounts.sent + stats.statusCounts.failed)) *
        100,
      recentFailureCount: stats.recentFailureCount,
      recentFailures: stats.recentFailures,
    };
  }

  /**
   * Health check endpoint
   */
  @Get('health/status')
  @SkipRateLimit() // No rate limit for health checks
  @ApiOperation({
    summary: 'Health check',
    description: 'Check if notification service is healthy',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Service is healthy',
  })
  healthCheck() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'notifications',
    };
  }

  /**
   * Test endpoint for development
   */
  @Post('test/email')
  @ApiOperation({
    summary: 'Test email delivery',
    description: 'Send a test email notification (development only)',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Test notification created',
  })
  async testEmail(@Body() body: { email: string }) {
    if (process.env.NODE_ENV !== 'development') {
      throw new BadRequestException(
        'Test endpoint only available in development',
      );
    }

    const dto = new CreateNotificationDto();
    dto.channel = NotificationChannel.EMAIL;
    dto.recipient = body.email;
    dto.subject = 'Test Notification from NotifyHub';
    dto.content = `
      <h2>Test Email</h2>
      <p>This is a test email sent at ${new Date().toISOString()}</p>
      <p>If you received this, the email system is working!</p>
    `;
    dto.metadata = {
      test: true,
      timestamp: new Date().toISOString(),
    };

    const notification = await this.notificationService.create(dto);

    return {
      message: 'Test notification created',
      notificationId: notification.id,
      checkStatusAt: `/api/v1/notifications/${notification.id}`,
    };
  }
}

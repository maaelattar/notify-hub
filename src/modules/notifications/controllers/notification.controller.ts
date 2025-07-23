import { Controller, Get, Post, Body, Param, Put, Delete, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiQuery } from '@nestjs/swagger';
import { CreateNotificationDto } from '../dto/create-notification.dto';
import { UpdateNotificationDto } from '../dto/update-notification.dto';
import { NotificationResponseDto } from '../dto/notification-response.dto';
import { NotificationFilterDto } from '../dto/notification-filter.dto';
import { PaginatedResponseDto } from '../dto/paginated-response.dto';
import { NotificationStatsDto } from '../dto/notification-stats.dto';
import { NotificationCommandService } from '../services/notification-command.service';
import { NotificationQueryService } from '../services/notification-query.service';
import { NotificationStatus } from '../enums/notification-status.enum';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly commandService: NotificationCommandService,
    private readonly queryService: NotificationQueryService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new notification' })
  @ApiResponse({ status: 201, description: 'The notification has been successfully created.', type: NotificationResponseDto })
  @ApiResponse({ status: 400, description: 'Bad Request.' })
  async create(@Body() createNotificationDto: CreateNotificationDto): Promise<NotificationResponseDto> {
    const notification = await this.commandService.create(createNotificationDto);
    return NotificationResponseDto.fromEntity(notification);
  }

  @Get()
  @ApiOperation({ summary: 'Find all notifications' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'A list of notifications.', type: PaginatedResponseDto })
  async findAll(
    @Query() filterDto: NotificationFilterDto,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ): Promise<PaginatedResponseDto<NotificationResponseDto>> {
    const result = await this.queryService.findAll(filterDto, { page, limit });
    const responseData = result.data.map(NotificationResponseDto.fromEntity);
    return new PaginatedResponseDto(responseData, result.total, result.pagination);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get notification statistics' })
  @ApiResponse({ status: 200, description: 'Notification statistics.', type: NotificationStatsDto })
  async getStats(): Promise<NotificationStatsDto> {
    return this.queryService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Find a notification by ID' })
  @ApiResponse({ status: 200, description: 'The found notification.', type: NotificationResponseDto })
  @ApiResponse({ status: 404, description: 'Not Found.' })
  async findOne(@Param('id') id: string): Promise<NotificationResponseDto> {
    const notification = await this.queryService.findById(id);
    return NotificationResponseDto.fromEntity(notification);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a notification' })
  @ApiResponse({ status: 200, description: 'The updated notification.', type: NotificationResponseDto })
  @ApiResponse({ status: 404, description: 'Not Found.' })
  async update(
    @Param('id') id: string,
    @Body() updateNotificationDto: UpdateNotificationDto,
  ): Promise<NotificationResponseDto> {
    const notification = await this.commandService.update(id, updateNotificationDto);
    return NotificationResponseDto.fromEntity(notification);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a notification' })
  @ApiResponse({ status: 204, description: 'The notification has been successfully cancelled.' })
  @ApiResponse({ status: 404, description: 'Not Found.' })
  async cancel(@Param('id') id: string): Promise<void> {
    await this.commandService.cancel(id);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed notification' })
  @ApiResponse({ status: 200, description: 'The retried notification.', type: NotificationResponseDto })
  @ApiResponse({ status: 404, description: 'Not Found.' })
  async retry(@Param('id') id: string): Promise<NotificationResponseDto> {
    const notification = await this.commandService.retry(id);
    return NotificationResponseDto.fromEntity(notification);
  }
}
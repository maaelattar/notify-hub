import { Controller, Get, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  AdvancedHealthService,
  SystemHealthReport,
} from './advanced-health.service';
import { QueueHealthIndicator } from './queue-health.indicator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: AdvancedHealthService,
    private readonly queueHealthIndicator: QueueHealthIndicator,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get basic health status' })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'healthy' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Service is unhealthy',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'down' },
        timestamp: { type: 'string', format: 'date-time' },
      },
    },
  })
  async getHealth() {
    try {
      const health = await this.healthService.getSimpleHealth();
      return {
        status: health.status,
        timestamp: health.timestamp,
      };
    } catch (error) {
      return {
        status: 'down',
        timestamp: new Date(),
        error: 'Health check failed',
      };
    }
  }

  @Get('detailed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get detailed system health report' })
  @ApiResponse({
    status: 200,
    description: 'Detailed health report',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        timestamp: { type: 'string', format: 'date-time' },
        version: { type: 'string' },
        uptime: { type: 'number' },
        components: { type: 'object' },
        performance: { type: 'object' },
        metrics: { type: 'object' },
      },
    },
  })
  async getDetailedHealth(): Promise<SystemHealthReport> {
    return this.healthService.getSystemHealth();
  }

  @Get('database')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check database health' })
  @ApiResponse({
    status: 200,
    description: 'Database health status',
  })
  async getDatabaseHealth() {
    return this.healthService.checkDatabase();
  }

  @Get('cache')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check cache health' })
  @ApiResponse({
    status: 200,
    description: 'Cache health status',
  })
  async getCacheHealth() {
    return this.healthService.checkCache();
  }

  @Get('queue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check queue health' })
  @ApiResponse({
    status: 200,
    description: 'Queue health status',
  })
  async getQueueHealth() {
    return this.healthService.checkQueue();
  }

  @Get('dependencies')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check external dependencies health' })
  @ApiResponse({
    status: 200,
    description: 'Dependencies health status',
  })
  async getDependenciesHealth() {
    return this.healthService.checkDependencies();
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kubernetes readiness probe' })
  @ApiResponse({
    status: 200,
    description: 'Service is ready to accept traffic',
  })
  @ApiResponse({
    status: 503,
    description: 'Service is not ready',
  })
  async getReadiness() {
    try {
      const health = await this.healthService.getSystemHealth();

      // Service is ready if database and cache are healthy
      const isReady =
        health.components.database.status === 'healthy' &&
        health.components.cache.status === 'healthy';

      if (isReady) {
        return {
          status: 'ready',
          timestamp: new Date(),
        };
      } else {
        throw new Error('Service not ready');
      }
    } catch (error) {
      return {
        status: 'not ready',
        timestamp: new Date(),
        error: 'Readiness check failed',
      };
    }
  }

  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kubernetes liveness probe' })
  @ApiResponse({
    status: 200,
    description: 'Service is alive',
  })
  async getLiveness() {
    // Simple liveness check - if we can respond, we're alive
    return {
      status: 'alive',
      timestamp: new Date(),
      uptime: process.uptime(),
    };
  }
}

import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { validationExceptionFactory } from './common/factories/validation-exception.factory';
import { RateLimitHeaderInterceptor } from './common/interceptors/rate-limit-header.interceptor';
import {
  CorrelationIdMiddleware,
  RequestWithCorrelationId,
} from './common/middleware/correlation-id.middleware';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ApiVersionInterceptor } from './common/interceptors/api-version.interceptor';
import { APP_CONSTANTS } from './common/constants/app.constants';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Correlation ID middleware
  const correlationMiddleware = new CorrelationIdMiddleware();
  app.use((req: Request, res: Response, next: NextFunction) =>
    correlationMiddleware.use(req as RequestWithCorrelationId, res, next),
  );

  // Global prefix
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  // Enable CORS with production-ready settings
  const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || [
    APP_CONSTANTS.SERVER.LOCAL_BASE_URL,
  ];
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Request-ID',
      'X-Correlation-ID',
      'Idempotency-Key',
    ],
    exposedHeaders: [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-Request-ID',
      'X-Correlation-ID',
      'X-API-Version',
      'X-Idempotent-Replayed',
    ],
    maxAge: APP_CONSTANTS.TIME_SECONDS.DAY, // 24 hours
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: validationExceptionFactory,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter is now provided via APP_FILTER in app.module.ts

  // Global interceptors
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new ApiVersionInterceptor(),
    new RateLimitHeaderInterceptor(app.get(Reflector)),
  );

  // Swagger setup with enhanced configuration
  const config = new DocumentBuilder()
    .setTitle('NotifyHub API')
    .setDescription(
      `
      NotifyHub is a multi-channel notification service that supports email, SMS, push notifications, and webhooks.
      
      ## Authentication
      The API supports two authentication methods:
      - **Bearer Token**: JWT tokens for user authentication
      - **API Key**: For server-to-server communication
      
      ## Rate Limiting
      - Standard endpoints: 100 requests per minute
      - Create notification: 10 requests per minute
      - Statistics: 5 requests per 5 minutes
      
      ## Error Codes
      All errors follow a consistent format with machine-readable codes.
    `,
    )
    .setVersion(APP_CONSTANTS.SERVER.API_VERSION)
    .addTag('notifications', 'Notification management endpoints')
    .addTag('health', 'Health check endpoints')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Enter JWT token',
    })
    .addApiKey({
      type: 'apiKey',
      name: 'X-API-Key',
      in: 'header',
      description: 'API key for server-to-server communication',
    })
    .addServer('https://api.notifyhub.com', 'Production')
    .addServer('https://staging-api.notifyhub.com', 'Staging')
    .addServer(APP_CONSTANTS.SERVER.LOCAL_BASE_URL, 'Development')
    .setExternalDoc('API Documentation', 'https://docs.notifyhub.com')
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .setContact(
      'NotifyHub Support',
      'https://notifyhub.com/support',
      'support@notifyhub.com',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT || APP_CONSTANTS.SERVER.DEFAULT_PORT;
  await app.listen(port);

  console.log(`NotifyHub API running on http://localhost:${port}`);
  console.log(`Swagger documentation at http://localhost:${port}/api`);
}

void bootstrap();

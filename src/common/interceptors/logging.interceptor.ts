import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { RequestWithCorrelationId } from '../middleware/correlation-id.middleware';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const now = Date.now();
    const req = context.switchToHttp().getRequest<RequestWithCorrelationId>();
    const res = context.switchToHttp().getResponse<Response>();

    const method = req.method;
    const url = req.url;
    const userAgent = req.get('User-Agent') || '';
    const ip = req.ip || req.connection.remoteAddress;
    const correlationId = req.correlationId;

    const requestLog = {
      correlationId,
      method,
      url,
      ip,
      userAgent,
      timestamp: new Date().toISOString(),
    };

    this.logger.log(`→ ${method} ${url}`, requestLog);

    return next.handle().pipe(
      tap({
        next: (data) => {
          const statusCode = res.statusCode;
          const responseTime = Date.now() - now;

          const responseLog = {
            correlationId,
            method,
            url,
            statusCode,
            responseTime: `${responseTime}ms`,
            responseSize: JSON.stringify(data).length,
            timestamp: new Date().toISOString(),
          };

          this.logger.log(
            `← ${method} ${url} ${statusCode} ${responseTime}ms`,
            responseLog,
          );
        },
        error: (error: unknown) => {
          const statusCode = res.statusCode || 500;
          const responseTime = Date.now() - now;
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';

          const errorLog = {
            correlationId,
            method,
            url,
            statusCode,
            responseTime: `${responseTime}ms`,
            error: errorMessage,
            timestamp: new Date().toISOString(),
          };

          this.logger.error(
            `← ${method} ${url} ${statusCode} ${responseTime}ms - ${errorMessage}`,
            errorLog,
          );
        },
      }),
    );
  }
}

import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { METRICS_KEY, MetricOptions } from '../decorators/metrics.decorator';
import { IMetricsService } from '../services/metrics.interface';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly metricsService: IMetricsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const metricOptions = this.reflector.get<MetricOptions>(
      METRICS_KEY,
      context.getHandler(),
    );

    if (!metricOptions) {
      return next.handle();
    }

    const startTime = Date.now();
    const { name, labels, successLabel, failureLabel, durationMetric } = metricOptions;

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        this.metricsService.recordSuccess(
          name,
          duration,
          { ...labels, status: successLabel || 'success' },
        );
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.metricsService.recordFailure(
          name,
          error.message,
          { ...labels, status: failureLabel || 'failure' },
        );
        throw error;
      }),
    );
  }
}

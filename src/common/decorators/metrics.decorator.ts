import { SetMetadata } from '@nestjs/common';

export const METRICS_KEY = 'metrics';

export interface MetricOptions {
  name: string;
  labels?: Record<string, string>;
  successLabel?: string;
  failureLabel?: string;
  durationMetric?: boolean;
}

export const Metrics = (options: MetricOptions) =>
  SetMetadata(METRICS_KEY, options);

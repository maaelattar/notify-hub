export interface IMetricsService {
  recordSuccess(name: string, duration: number, labels?: Record<string, string>): void;
  recordFailure(name: string, error: string, labels?: Record<string, string>): void;
}

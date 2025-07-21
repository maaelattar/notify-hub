import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export interface RequestWithCorrelationId extends Request {
  correlationId: string;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: RequestWithCorrelationId, res: Response, next: NextFunction) {
    // Check for existing correlation ID in headers, otherwise generate new one
    req.correlationId =
      (req.headers['x-correlation-id'] as string) ||
      (req.headers['x-request-id'] as string) ||
      randomUUID();

    // Add correlation ID to response headers
    res.setHeader('X-Correlation-ID', req.correlationId);
    res.setHeader('X-Request-ID', req.correlationId);

    // Make it available for logging
    res.locals.correlationId = req.correlationId;

    next();
  }
}

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { ApiKey } from '../entities/api-key.entity';

import { ApiKey } from '../entities/api-key.entity';

export interface RequestWithCorrelationId extends Request {
  correlationId: string;
  user?: { id: string }; // Assuming a simple user object with an ID
  apiKey?: ApiKey; // Assuming ApiKey entity is available
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

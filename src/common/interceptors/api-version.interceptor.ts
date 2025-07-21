import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class ApiVersionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<{
          setHeader: (key: string, value: string) => void;
        }>();
        response.setHeader('X-API-Version', '1.0');
        response.setHeader('X-API-Deprecation-Date', '');
        response.setHeader('X-API-Supported-Versions', '1.0');
      }),
    );
  }
}
